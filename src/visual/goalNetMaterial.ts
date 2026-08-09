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
		sin(pos.y * 3.2 + uTime * 3.4) * 0.01 +
		sin(pos.x * 2.8 + uTime * 2.6) * 0.007 +
		cos(pos.y * 1.6 - uTime * 2.1) * 0.005;
	pos.z += wave;
	float hit = uGoalRipple * sin(length(pos.xz) * 11.0 - uTime * 26.0);
	pos.z += hit * 0.32 * uGoalRipple;
	pos.y += hit * 0.07 * uGoalRipple;

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

/** Hex energy field (RL goal net). */
float hexGrid(vec2 p) {
	p = abs(p);
	return max(p.x * 0.866025 + p.y * 0.5, p.y);
}

void main() {
	vec2 g = vUv * uGridScale;
	g += sin(vWorldPos.y * 0.45 + uTime * 2.2) * 0.08;
	g.x += cos(vWorldPos.z * 0.35 + uTime * 1.8) * 0.06;

	vec2 hexUv = g;
	hexUv.x *= 1.1547;
	float row = floor(hexUv.y);
	hexUv.x += mod(row, 2.0) * 0.5;
	vec2 cell = fract(hexUv) - 0.5;
	float hd = hexGrid(cell);
	float fw = fwidth(hd) * 1.8;
	float hexLine = 1.0 - smoothstep(0.42, 0.42 + fw, hd);

	float pulse = 0.62 + 0.38 * sin(uTime * 2.85 + vWorldPos.x * 0.22);
	pulse += 0.12 * sin(uTime * 1.35 + vWorldPos.z * 0.15);
	pulse += uGoalRipple * 1.1;

	/** Energy fill — półprzezroczysta poświata + hex. */
	float fill = 0.34 + 0.18 * pulse;
	float alpha = mix(fill, 0.96, hexLine) * uOpacity * (0.8 + pulse * 0.28);

	vec3 baseCol = uColor * 0.2;
	vec3 col = mix(baseCol, uColor, 0.42 + hexLine * 0.58 + uGoalRipple * 0.4);
	col += uColor * (0.4 + hexLine * 0.55 + pulse * 0.35 + uGoalRipple * 0.5);
	col += vec3(0.15, 0.25, 0.4) * fill * 0.4;

	if (alpha < 0.03) discard;
	gl_FragColor = vec4(col, alpha);
}
`;

/** Energy-field siatka bramkowa (hex + glow). */
export function createGoalNetMaterial(
	team: "blue" | "orange",
): THREE.ShaderMaterial {
	const hex = team === "blue" ? RL.goalBlue : RL.goalOrange;
	const mat = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uColor: { value: new THREE.Color(hex) },
			uGridScale: { value: 11 },
			uOpacity: { value: 0.82 },
			uGoalRipple: { value: 0 },
		},
		vertexShader: NET_VERTEX,
		fragmentShader: NET_FRAGMENT,
		transparent: true,
		depthWrite: false,
		depthTest: true,
		side: THREE.FrontSide,
		polygonOffset: true,
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -1,
	});
	netEntries.push({ mat, team });
	return mat;
}

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
