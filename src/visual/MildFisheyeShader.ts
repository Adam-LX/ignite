import * as THREE from "three";

/**
 * Lekki barrel — więcej otoczenia na brzegach.
 * Zoom + cofnięcie korekty aspect, żeby UV zawsze było w [0,1].
 * Sam `clamp` na krawędzi = pionowe/poziome „smugi”.
 */
export const MildFisheyeShader: {
	uniforms: {
		tDiffuse: { value: THREE.Texture | null };
		uStrength: { value: number };
	};
	vertexShader: string;
	fragmentShader: string;
} = {
	uniforms: {
		tDiffuse: { value: null },
		/** Słabsze niż wcześniej — barrel + clamp dawały smugi. */
		uStrength: { value: 0.022 },
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
		uniform float uStrength;
		varying vec2 vUv;

		void main() {
			const float aspect = 1.05;
			vec2 d = vUv - 0.5;
			d.x *= aspect;
			float r2 = dot(d, d);
			float k = max(uStrength, 0.0);
			float cornerR2 = 0.25 + 0.25 * aspect * aspect;
			float zoom = 1.0 + k * cornerR2;
			vec2 distorted = d * ((1.0 + k * r2) / zoom);
			distorted.x /= aspect;
			vec2 sampleUv = 0.5 + distorted;
			gl_FragColor = texture2D(tDiffuse, sampleUv);
		}
	`,
};
