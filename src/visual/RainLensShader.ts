import * as THREE from "three";

/**
 * Soczewka: klasyczne okrągłe krople + nieregularne zacieki/smugi ściekające
 * + okazjonalne rozpryski. Refrakcja bez netto „pitch down” (nie topi horyzontu).
 */
export const RainLensShader: {
	uniforms: {
		tDiffuse: { value: THREE.Texture | null };
		time: { value: number };
		rainAmount: { value: number };
	};
	vertexShader: string;
	fragmentShader: string;
} = {
	uniforms: {
		tDiffuse: { value: null },
		time: { value: 0 },
		rainAmount: { value: 0 },
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform float time;
		uniform float rainAmount;
		varying vec2 vUv;

		float rand(vec2 n) {
			return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
		}

		float noise(vec2 p) {
			vec2 i = floor(p);
			vec2 f = fract(p);
			float a = rand(i);
			float b = rand(i + vec2(1.0, 0.0));
			float c = rand(i + vec2(0.0, 1.0));
			float d = rand(i + vec2(1.0, 1.0));
			vec2 u = f * f * (3.0 - 2.0 * f);
			return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
		}

		/**
		 * .x = refrakcja (kropla + smuga + splash)
		 * .y = miękka poświata smugi
		 * .z = radialny kierunek zniekształcenia (unikamy stałego +Y)
		 */
		vec3 createDropLayer(vec2 uv, float scale, float speed) {
			vec2 grid = uv * vec2(scale * 1.5, scale);
			vec2 cellId = floor(grid);
			vec2 cellUv = fract(grid) - 0.5;

			float n0 = rand(cellId);
			float n1 = rand(cellId + 17.3);
			float n2 = rand(cellId + 53.9);

			float dripSpeed = speed * (0.4 + n1 * 1.1);
			float phase = n2 * 6.2832;
			float continuous = time * dripSpeed + phase;
			float discrete = floor(continuous * 0.7);
			float slide = fract(continuous * 0.7);

			cellId.y += discrete;
			cellUv.y += (slide - 0.5) * 0.42;

			float n = rand(cellId);
			float nSize = rand(cellId + 1.0);
			float nTrail = rand(cellId + 8.4);
			float nSplash = rand(cellId + 27.1);
			float nWobble = rand(cellId + 61.0);

			// Więcej kropel niż ostatnio, nadal nie „zalanie”
			float spawn = step(0.68, n);

			vec2 center = vec2((nSize - 0.5) * 0.32, (nTrail - 0.5) * 0.22);
			vec2 local = cellUv - center;

			float size = 0.16 + nSize * 0.18 + step(0.88, nSplash) * 0.1;
			float bead = smoothstep(size, size * 0.58, length(local));

			// Nieregularny zaciek: meander + zmienna grubość wzdłuż ścieżki
			float trailLen = 0.55 + nTrail * 0.85 + slide * 0.55;
			float along = clamp((-local.y) / max(trailLen, 0.15), 0.0, 1.0);
			float wobble =
				(noise(vec2(cellId.x * 0.37 + along * 4.0, time * 0.15 + nWobble)) - 0.5) *
				(0.08 + nWobble * 0.12);
			float widthVar =
				0.035 + nTrail * 0.04 +
				noise(vec2(along * 6.0, cellId.y * 0.2)) * 0.05;
			// Czasem rozdzielenie na dwa cienkie strugi
			float dual = step(0.72, nSplash);
			float d1 = abs(local.x - wobble);
			float d2 = abs(local.x - wobble * 0.55 - 0.04 * dual);
			float streakCore = 1.0 - smoothstep(0.0, widthVar, min(d1, mix(1.0, d2, dual)));
			float streakFade = smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.75, 1.0, along));
			float below = smoothstep(0.15, -0.05, local.y);
			float streak = streakCore * streakFade * below * (0.5 + slide * 0.5);
			// Krople „osadu” wzdłuż smugi
			float beadOnStreak =
				smoothstep(0.06, 0.02, length(vec2(local.x - wobble, local.y + along * trailLen * 0.55))) *
				step(0.55, noise(vec2(along * 9.0, cellId.x))) *
				below * 0.65;

			// Rozprysk: rzadziej, ale wyraźniej — pierścień + mikrokropelki
			float doSplash = step(0.62, nSplash);
			float splashPulse =
				smoothstep(0.18, 0.0, slide) * smoothstep(0.0, 0.05, slide + 0.03) * doSplash;
			float ringR = size * (1.15 + nSize * 0.5);
			float ring = 1.0 - smoothstep(0.0, 0.07, abs(length(local) - ringR));
			float splash = ring * splashPulse;

			float micro = 0.0;
			if (splashPulse > 0.02) {
				for (int i = 0; i < 5; i++) {
					float fi = float(i);
					float ang = fi * 1.2566 + nSplash * 6.28;
					float rad = size * (1.3 + fract(nSize * 7.1 + fi * 0.17) * 0.9);
					vec2 mp = local - vec2(cos(ang), sin(ang) * 0.65) * rad;
					micro += smoothstep(0.09, 0.02, length(mp));
				}
				micro *= splashPulse * 0.55;
			}

			float mask =
				(bead * 1.05 + streak * 0.75 + beadOnStreak + splash * 0.9 + micro) * spawn;
			float soft = (bead * 0.35 + streak * 1.0 + beadOnStreak * 0.6) * spawn;

			// Kierunek zniekształcenia od środka kropli — bez stałego +Y
			vec2 dir = local;
			float dirLen = length(dir);
			dir = dirLen > 1e-4 ? dir / dirLen : vec2(0.0, 1.0);

			return vec3(mask, soft, dir.x * mask);
		}

		void main() {
			vec2 uv = vUv;

			if (rainAmount > 0.001) {
				vec3 a = createDropLayer(uv, 8.0, 0.7);
				vec3 b = createDropLayer(uv, 13.0, 1.1);
				vec3 c = createDropLayer(uv, 22.0, 1.6);

				float drops = a.x + b.x * 0.75 + c.x * 0.5;
				float haze = a.y + b.y * 0.55 + c.y * 0.35;
				float biasX = a.z + b.z * 0.7 + c.z * 0.45;

				float strength = rainAmount * 1.05;
				// Symetryczna refrakcja — nie przesuwamy całego kadru w dół (trawa ≠ pitch)
				vec2 offset = vec2(biasX * 0.028, (drops * 0.012 - haze * 0.006)) * strength;
				uv += offset;

				vec4 sharp = texture2D(tDiffuse, uv);
				vec4 softTex = texture2D(tDiffuse, uv + vec2(0.004) * (drops + haze * 0.4));

				float mixAmt = clamp((drops * 0.85 + haze * 0.4) * strength, 0.0, 0.7);
				gl_FragColor = mix(sharp, softTex, mixAmt);
			} else {
				gl_FragColor = texture2D(tDiffuse, uv);
			}
		}
	`,
};
