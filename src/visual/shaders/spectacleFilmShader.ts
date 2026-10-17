import * as THREE from "three";

/**
 * Film look dla prematch slam / goal spectacle —
 * soft grain + edge chroma + anamorphic kiss (cyan/warm, nie fiolet).
 */
export const SpectacleFilmShader: {
	uniforms: {
		tDiffuse: { value: THREE.Texture | null };
		uTime: { value: number };
		uSpectacle: { value: number };
		uGrain: { value: number };
	};
	vertexShader: string;
	fragmentShader: string;
} = {
	uniforms: {
		tDiffuse: { value: null },
		uTime: { value: 0 },
		uSpectacle: { value: 0 },
		uGrain: { value: 0.35 },
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
		uniform float uTime;
		uniform float uSpectacle;
		uniform float uGrain;
		varying vec2 vUv;

		float hash21(vec2 p) {
			p = fract(p * vec2(123.34, 456.21));
			p += dot(p, p + 45.32);
			return fract(p.x * p.y);
		}

		void main() {
			vec2 uv = vUv;
			vec2 fromC = uv - 0.5;
			float edge = length(fromC);
			float spec = clamp(uSpectacle, 0.0, 1.4);

			/** Edge chromatic — mocniej przy slam. */
			float chromaAmt = (0.002 + spec * 0.01) * edge * edge;
			vec3 col;
			col.r = texture2D(tDiffuse, uv + fromC * chromaAmt).r;
			col.g = texture2D(tDiffuse, uv).g;
			col.b = texture2D(tDiffuse, uv - fromC * chromaAmt).b;

			/** Anamorphic kiss na highlightach (cyan/warm). */
			if (spec > 0.04) {
				vec3 streak = vec3(0.0);
				float sw = 0.0;
				for (int i = -4; i <= 4; i++) {
					if (i == 0) continue;
					float f = float(i);
					float w = 1.0 - abs(f) / 5.0;
					vec2 off = vec2(f * 0.0035 * spec, 0.0);
					vec3 s = texture2D(tDiffuse, uv + off).rgb;
					float lum = max(s.r, max(s.g, s.b));
					float hw = w * smoothstep(0.58, 0.92, lum);
					streak += s * hw;
					sw += hw;
				}
				if (sw > 0.001) {
					vec3 tint = mix(vec3(1.05, 0.92, 0.78), vec3(0.72, 0.9, 1.08), 0.55);
					col += (streak / sw) * tint * spec * 0.32;
				}
			}

			/** Soft film grain — temporal, niski kontrast. */
			float gAmt = uGrain * (0.55 + spec * 0.7);
			if (gAmt > 0.001) {
				float n = hash21(uv * vec2(1920.0, 1080.0) + fract(uTime * 17.13) * 100.0);
				n = (n - 0.5) * 2.0;
				float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
				/** Więcej grain w midtones, mniej w czerni/bieli. */
				float mid = smoothstep(0.08, 0.35, luma) * (1.0 - smoothstep(0.65, 0.95, luma));
				col += n * gAmt * 0.045 * mid;
			}

			gl_FragColor = vec4(col, 1.0);
		}
	`,
};
