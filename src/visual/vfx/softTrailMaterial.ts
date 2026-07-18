import * as THREE from "three";

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vLocalPos;

void main() {
	vUv = uv;
	vLocalPos = position;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColorHead;
uniform vec3 uColorTail;
uniform float uOpacity;
uniform float uGlowPower;

varying vec2 vUv;
varying vec3 vLocalPos;

void main() {
	float along = vUv.y;
	float radial = length(vLocalPos.xz);
	float softRadial = pow(1.0 - clamp(radial, 0.0, 1.0), uGlowPower);
	float softCap = smoothstep(0.0, 0.12, along) * smoothstep(1.0, 0.55, along);
	vec3 col = mix(uColorTail, uColorHead, pow(along, 0.72));
	float alpha = uOpacity * softRadial * softCap;
	if (alpha < 0.004) discard;
	gl_FragColor = vec4(col, alpha);
}
`;

/** Miękka smuga z radialnym rozmyciem — additive, niska bazowa krycie. */
export function createSoftTrailMaterial(
	glowPower = 2.35,
): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: {
			uColorHead: { value: new THREE.Color(0xaaffff) },
			uColorTail: { value: new THREE.Color(0xff66cc) },
			uOpacity: { value: 0.32 },
			uGlowPower: { value: glowPower },
		},
		vertexShader: VERT,
		fragmentShader: FRAG,
		transparent: true,
		depthWrite: false,
		depthTest: true,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		fog: false,
	});
}

export function setSoftTrailColors(
	mat: THREE.ShaderMaterial,
	head: THREE.Color,
	tail: THREE.Color,
	opacity: number,
): void {
	mat.uniforms.uColorHead.value.copy(head);
	mat.uniforms.uColorTail.value.copy(tail);
	mat.uniforms.uOpacity.value = opacity;
}
