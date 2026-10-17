import * as THREE from "three";

export const LensHaloShader = {
	uniforms: {
		tDiffuse: { value: null },
		time: { value: 0 },
		haloAmount: { value: 0 },
		dirtAmount: { value: 0 },
		streakAmount: { value: 0 },
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = vec4(position.xy, 1.0, 1.0);
		}
	`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform float time;
		uniform float haloAmount;
		uniform float dirtAmount;
		uniform float streakAmount;

		varying vec2 vUv;

		float hash(vec2 p) {
			return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
		}

		float noise(vec2 p) {
			vec2 i = floor(p);
			vec2 f = fract(p);
			float a = hash(i);
			float b = hash(i + vec2(1.0, 0.0));
			float c = hash(i + vec2(0.0, 1.0));
			float d = hash(i + vec2(1.0, 1.0));
			vec2 u = f * f * (3.0 - 2.0 * f);
			return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
		}

		vec3 sampleBlur(vec2 uv, vec2 dir, float radius) {
			vec3 acc = vec3(0.0);
			float wsum = 0.0;
			for (int i = -3; i <= 3; i++) {
				float t = float(i) / 3.0;
				float w = 1.0 - abs(t);
				acc += texture2D(tDiffuse, uv + dir * t * radius).rgb * w;
				wsum += w;
			}
			return acc / max(wsum, 1e-4);
		}

		void main() {
			vec3 col = texture2D(tDiffuse, vUv).rgb;
			float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
			// High-end but gameplay-safe: react only to stronger highlights.
			float bright = smoothstep(0.72, 1.22, luma);

			vec2 centered = vUv - 0.5;
			float dist = length(centered);
			float centerBias = 1.0 - smoothstep(0.1, 0.78, dist);

			vec3 haloBlur = sampleBlur(vUv, normalize(centered + vec2(1e-4)), 0.042);
			float haloMask = bright * (0.48 + 0.52 * centerBias);
			vec3 halo = haloBlur * haloMask * haloAmount * 0.18;
			/** Delikatna poświata spektralna na mocnych highlightach. */
			vec3 haloSpec = haloBlur * vec3(1.05, 0.98, 1.18) * haloMask * haloAmount * 0.06;

			float streakMask = bright * (0.58 + 0.42 * centerBias);
			vec3 streak = sampleBlur(vUv, vec2(1.0, 0.0), 0.078);
			streak *= exp(-abs(centered.y) * 7.8) * streakMask * streakAmount * 0.14;
			vec3 streakCool = streak * vec3(0.82, 0.92, 1.15);

			float d0 = noise(vUv * 7.0 + vec2(time * 0.013, -time * 0.009));
			float d1 = noise(vUv * 18.0 - vec2(time * 0.011, time * 0.015));
			float grime = smoothstep(0.58, 0.98, d0 * 0.6 + d1 * 0.4);
			float dirtMask = grime * bright * smoothstep(0.08, 0.92, dist);
			vec3 dirt = vec3(1.0, 0.94, 0.82) * dirtMask * dirtAmount * 0.048 * luma;

			vec3 outCol = col + halo + haloSpec + streakCool + dirt;
			gl_FragColor = vec4(outCol, 1.0);
		}
	`,
} satisfies {
	uniforms: Record<string, THREE.IUniform>;
	vertexShader: string;
	fragmentShader: string;
};
