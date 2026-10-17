import * as THREE from "three";

/**
 * Grade meczu — murawa czytelna, skybox WIDOCZNY (jak bez reflektorów na niebie).
 * Anty-mleko: tylko desaturowany haze, nie crush całego nieba.
 */
export const MatchColorGradeShader: {
	uniforms: {
		tDiffuse: { value: THREE.Texture | null };
		uSaturation: { value: number };
		uCool: { value: number };
		uWarm: { value: number };
		uLift: { value: number };
		uChroma: { value: number };
	};
	vertexShader: string;
	fragmentShader: string;
} = {
	uniforms: {
		tDiffuse: { value: null },
		uSaturation: { value: 1.4 },
		uCool: { value: 0.18 },
		uWarm: { value: 0.06 },
		uLift: { value: 1.0 },
		uChroma: { value: 0 },
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
		uniform float uSaturation;
		uniform float uCool;
		uniform float uWarm;
		uniform float uLift;
		uniform float uChroma;
		varying vec2 vUv;

		void main() {
			vec2 uv = vUv;
			vec3 col;
			if (uChroma > 0.004) {
				vec2 fromC = uv - 0.5;
				float edge = length(fromC);
				float amt = uChroma * 0.007 * edge;
				col.r = texture2D(tDiffuse, uv + fromC * amt).r;
				col.g = texture2D(tDiffuse, uv).g;
				col.b = texture2D(tDiffuse, uv - fromC * amt).b;
			} else {
				col = texture2D(tDiffuse, uv).rgb;
			}
			col *= uLift;

			float vig = smoothstep(1.22, 0.42, length(uv - 0.5));
			col *= mix(0.88, 1.0, vig);

			/** Premium: lokalny kontrast na murawie (dolna połowa) — głębia bez wash. */
			float pitch = 1.0 - smoothstep(0.38, 0.72, uv.y);
			float pitchLuma = dot(col, vec3(0.2126, 0.7152, 0.0722));
			col = mix(col, col * (0.9 + pitchLuma * 0.16), pitch * 0.5);
			col = (col - 0.36) * mix(1.0, 1.14, pitch * 0.72) + 0.36;

			float sky = smoothstep(0.42, 0.82, uv.y);
			float hz = clamp(1.0 - abs(uv.y - 0.52) * 4.2, 0.0, 1.0);

			/**
			 * Lekki lokalny kontrast na niebie — bez globalnego ×0.72 crush
			 * (to robiło czarną dziurę zamiast city skyboxa).
			 */
			float pivot = mix(0.42, 0.32, sky);
			float contrastAmt = mix(1.05, 1.22, sky);
			col = (col - pivot) * contrastAmt + pivot;

			float lumaSky = dot(col, vec3(0.2126, 0.7152, 0.0722));
			float chromaSky = length(col - vec3(lumaSky));
			/**
			 * Tylko szaro-biały wash (niska chroma) — magenta/cyan city zostaje.
			 */
			float haze = smoothstep(0.28, 0.55, lumaSky)
				* (1.0 - smoothstep(0.06, 0.22, chromaSky));
			col *= mix(1.0, 0.58, haze * sky * 0.9);

			/** Cap highlightów agresywniej — CP-style: neon zostaje, plamy nie myją. */
			float hi = max(col.r, max(col.g, col.b));
			float skyCap = mix(1.05, 0.82, sky * 0.7 + hz * 0.3);
			if (hi > skyCap) {
				col *= skyCap / hi;
			}

			vec3 coolTint = vec3(0.86, 0.9, 1.22);
			col = mix(col, col * coolTint + vec3(0.008, 0.01, 0.05), uCool * 0.28);

			vec3 warmTint = vec3(1.12, 1.03, 0.88);
			col = mix(col, col * warmTint + vec3(0.025, 0.01, 0.0), uWarm * 0.2);

			/** Split tone na murawie — chłodne cienie, ciepłe highlighty (premium LUT). */
			float pitchTone = 1.0 - smoothstep(0.36, 0.7, uv.y);
			float lumaPre = dot(col, vec3(0.2126, 0.7152, 0.0722));
			vec3 shadowTeal = mix(col, col * vec3(0.88, 0.94, 1.08) + vec3(0.01, 0.015, 0.03), pitchTone * 0.38);
			vec3 hiWarm = mix(shadowTeal, shadowTeal * vec3(1.06, 1.02, 0.94) + vec3(0.012, 0.008, 0.0), smoothstep(0.35, 0.82, lumaPre));
			col = mix(col, hiWarm, pitchTone * 0.72);

			float gBias = max(0.0, col.g - max(col.r, col.b));
			col.g += gBias * 0.12;
			col.r *= 1.0 - gBias * 0.035;

			float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
			float chroma = length(col - vec3(luma));
			float vib = mix(
				uSaturation,
				1.0 + (uSaturation - 1.0) * 0.55,
				smoothstep(0.05, 0.28, chroma)
			);
			vib = mix(vib, vib * 1.12, sky * 0.55);
			col = mix(vec3(luma), col, clamp(vib, 0.85, 1.9));

			float hi2 = max(col.r, max(col.g, col.b));
			col *= mix(1.0, 0.92 / max(hi2, 0.92), smoothstep(0.85, 1.35, hi2));

			/** Bardzo subtelny grain — tylko murawa, nie niebo. */
			float grainPitch = 1.0 - smoothstep(0.48, 0.74, uv.y);
			float grain = fract(sin(dot(uv * vec2(1920.0, 1080.0), vec2(127.1, 311.7))) * 43758.5453) - 0.5;
			col += grain * grainPitch * 0.006;

			gl_FragColor = vec4(col, 1.0);
		}
	`,
};
