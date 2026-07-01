import * as THREE from "three";

/** Murawa nie renderuje snopów poniżej tej wysokości (ochrona przed białym przepaleniem). */
const PITCH_BEAM_CUTOFF_Y = 22;

/**
 * Mgliste snopy jupiterów — additive, miękki falloff.
 * Fragmenty poniżej boiska są odrzucane (nie przepalają murawy).
 */
export function createMistyBeamMaterial(
	color = 0xffffff,
): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		fog: false,
		depthTest: true,
		uniforms: {
			uColor: { value: new THREE.Color(color) },
			uOpacity: { value: 0.012 },
			uPitchCutoff: { value: PITCH_BEAM_CUTOFF_Y },
		},
		vertexShader: `
			varying vec2 vUv;
			varying vec3 vWorldPos;
			void main() {
				vUv = uv;
				vec4 worldPos = modelMatrix * vec4(position, 1.0);
				vWorldPos = worldPos.xyz;
				gl_Position = projectionMatrix * viewMatrix * worldPos;
			}
		`,
		fragmentShader: `
			uniform vec3 uColor;
			uniform float uOpacity;
			uniform float uPitchCutoff;
			varying vec2 vUv;
			varying vec3 vWorldPos;
			void main() {
				if (vWorldPos.y < uPitchCutoff) discard;
				float edge = abs(vUv.x - 0.5) * 2.0;
				float radial = pow(1.0 - clamp(edge, 0.0, 1.0), 3.2);
				float along = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
				float alpha = uOpacity * radial * along * 2.8;
				if (alpha < 0.0003) discard;
				gl_FragColor = vec4(uColor, alpha);
			}
		`,
	});
}

/** Prosty wariant MeshBasic — dla małych stożków fixture (tylko zewnętrzna ścianka). */
export function createJupiterConeMaterial(
	color = 0xffffff,
): THREE.MeshBasicMaterial {
	return new THREE.MeshBasicMaterial({
		color,
		transparent: true,
		opacity: 0.02,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.FrontSide,
		fog: false,
	});
}

/** Miękki gradientowy snop drona — zanik wzdłuż stożka i na krawędziach. */
export function createDroneVolumetricLightMaterial(
	color: THREE.Color,
	opacity = 0.4,
	beamLength = 42,
): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: {
			glowColor: { value: color.clone() },
			uOpacity: { value: opacity },
			uBeamLength: { value: beamLength },
		},
		vertexShader: `
			varying vec3 vLocalPos;
			varying vec2 vUv;
			void main() {
				vUv = uv;
				vLocalPos = position;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform vec3 glowColor;
			uniform float uOpacity;
			uniform float uBeamLength;
			varying vec3 vLocalPos;
			varying vec2 vUv;
			void main() {
				float heightFade = smoothstep(-uBeamLength, -uBeamLength * 0.04, vLocalPos.y);
				float apexFade = smoothstep(0.0, uBeamLength * 0.1, -vLocalPos.y);
				float edgeFade = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 2.4);
				float alpha = uOpacity * heightFade * apexFade * edgeFade;
				if (alpha < 0.0015) discard;
				gl_FragColor = vec4(glowColor, alpha);
			}
		`,
		transparent: true,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		depthWrite: false,
		fog: false,
	});
}

/** Snop reflektora drona — dłuższy, miękki, sięga do murawy. */
export function createDroneBeamMaterial(
	color: THREE.Color | number = 0xc8e8ff,
): THREE.ShaderMaterial {
	const c = color instanceof THREE.Color ? color : new THREE.Color(color);
	return createDroneVolumetricLightMaterial(c, 0.055, 42);
}

/** Snop reflektora bolidu — widoczny cylinder w mgle stadionu. */
export function createHeadlightBeamMaterial(
	color = 0xe8f4ff,
): THREE.ShaderMaterial {
	const mat = createMistyBeamMaterial(color);
	mat.uniforms.uOpacity.value = 0.038;
	return mat;
}

export function createSoftVolumetricMaterial(
	color = 0xe8f0ff,
	peakOpacity = 0.028,
): THREE.ShaderMaterial {
	const mat = createMistyBeamMaterial(color);
	mat.uniforms.uOpacity.value = peakOpacity;
	return mat;
}
