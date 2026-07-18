import * as THREE from "three";

import { RL } from "./materials";

type NetEntry = {
	mat: THREE.ShaderMaterial;
	team: "blue" | "orange";
};

const netEntries: NetEntry[] = [];
let rippleBlue = 0;
let rippleOrange = 0;

const NET_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uGoalRipple;

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
	float hit = uGoalRipple * sin(length(pos.xz) * 11.0 - uTime * 26.0);
	pos.z += hit * 0.92 * uGoalRipple;
	pos.y += hit * 0.18 * uGoalRipple;

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
uniform float uGoalRipple;

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
	pulse += uGoalRipple * 1.15;
	float fill = 0.18;
	float alpha = mix(fill, 0.95, grid) * uOpacity * pulse;

	vec3 baseCol = vec3(0.02, 0.04, 0.09);
	vec3 col = mix(baseCol, uColor, 0.45 + grid * 0.7 + uGoalRipple * 0.55);
	col += uColor * (0.35 + uGoalRipple * 0.5);

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
			uOpacity: { value: 0.74 },
			uGoalRipple: { value: 0 },
		},
		vertexShader: NET_VERTEX,
		fragmentShader: NET_FRAGMENT,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	netEntries.push({ mat, team });
	return mat;
}

/** Fala uderzeniowa siatki — `scoredInGoal` to drużyna bramki, w której padł gol. */
export function triggerGoalNetRipple(
	scoredInGoal: "blue" | "orange",
	strength = 1.4,
): void {
	if (scoredInGoal === "blue") rippleBlue = Math.max(rippleBlue, strength);
	else rippleOrange = Math.max(rippleOrange, strength);
}

export function updateGoalNetMaterials(timeSec: number, dt = 1 / 60): void {
	rippleBlue = Math.max(0, rippleBlue - dt * 2.15);
	rippleOrange = Math.max(0, rippleOrange - dt * 2.15);
	for (const entry of netEntries) {
		entry.mat.uniforms.uTime.value = timeSec;
		entry.mat.uniforms.uGoalRipple.value =
			entry.team === "blue" ? rippleBlue : rippleOrange;
	}
}
