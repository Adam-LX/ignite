import * as THREE from "three";

import { RL } from "./materials";

const netMaterials: THREE.ShaderMaterial[] = [];

const NET_VERTEX = /* glsl */ `
uniform float uTime;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
	vUv = uv;
	vec3 pos = position;
	float wave =
		sin(pos.y * 3.2 + uTime * 3.4) * 0.045 +
		sin(pos.x * 2.8 + uTime * 2.6) * 0.03 +
		cos(pos.y * 1.6 - uTime * 2.1) * 0.02;
	pos.z += wave;

	vec4 wp = modelMatrix * vec4(pos, 1.0);
	vWorldPos = wp.xyz;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const NET_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uGridScale;
uniform float uOpacity;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
	vec2 g = vUv * uGridScale;
	g += sin(vWorldPos.y * 0.55 + uTime * 2.8) * 0.12;
	g += cos(vWorldPos.x * 0.4 + vWorldPos.z * 0.35 + uTime * 2.2) * 0.08;

	vec2 f = abs(fract(g - 0.5) - 0.5);
	vec2 fw = fwidth(g);
	float lineX = 1.0 - smoothstep(0.0, fw.x * 1.6, f.x);
	float lineY = 1.0 - smoothstep(0.0, fw.y * 1.6, f.y);
	float grid = max(lineX, lineY);

	float pulse = 0.55 + 0.45 * sin(uTime * 3.6 + vWorldPos.x * 0.25 + vWorldPos.z * 0.2);
	float fill = 0.14;
	float alpha = mix(fill, 0.78, grid) * uOpacity * pulse;

	vec3 baseCol = vec3(0.02, 0.04, 0.09);
	vec3 col = mix(baseCol, uColor, 0.35 + grid * 0.65);

	if (alpha < 0.04) discard;
	gl_FragColor = vec4(col, alpha);
}
`;

/** Półprzezroczysta „żyjąca” siatka bramkowa. */
export function createGoalNetMaterial(
	team: "blue" | "orange",
): THREE.ShaderMaterial {
	const hex = team === "blue" ? RL.goalBlue : RL.goalOrange;
	const mat = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uColor: { value: new THREE.Color(hex) },
			uGridScale: { value: 18 },
			uOpacity: { value: 0.58 },
		},
		vertexShader: NET_VERTEX,
		fragmentShader: NET_FRAGMENT,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	netMaterials.push(mat);
	return mat;
}

export function updateGoalNetMaterials(timeSec: number): void {
	for (const mat of netMaterials) {
		mat.uniforms.uTime.value = timeSec;
	}
}
