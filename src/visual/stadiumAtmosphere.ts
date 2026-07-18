import * as THREE from "three";

import { RL_ARENA } from "./arenaConstants";

const PARTICLE_COUNT = 2800;

type AtmosphereRig = {
	root: THREE.Points;
	positions: Float32Array;
	velocities: Float32Array;
	phases: Float32Array;
};

let rig: AtmosphereRig | null = null;

function spawnParticle(
	positions: Float32Array,
	velocities: Float32Array,
	phases: Float32Array,
	i: number,
): void {
	const spanX = RL_ARENA.HALF_WIDTH + 48;
	const spanZ = RL_ARENA.HALF_LENGTH + 48;
	const ix = i * 3;

	positions[ix] = (Math.random() * 2 - 1) * spanX;
	positions[ix + 1] = Math.random() * 42 + 2;
	positions[ix + 2] = (Math.random() * 2 - 1) * spanZ;

	velocities[ix] = (Math.random() - 0.5) * 0.35;
	velocities[ix + 1] = 0.18 + Math.random() * 0.55;
	velocities[ix + 2] = (Math.random() - 0.5) * 0.35;
	phases[i] = Math.random() * Math.PI * 2;
}

const ATMOSPHERE_VERT = /* glsl */ `
attribute float aPhase;
attribute float aHue;

uniform float uTime;
uniform float uPulse;

varying float vAlpha;
varying vec3 vColor;

void main() {
	vec3 pos = position;
	pos.x += sin(uTime * 0.35 + aPhase) * 0.6;
	pos.z += cos(uTime * 0.28 + aPhase * 1.3) * 0.5;
	pos.y += sin(uTime * 0.9 + aPhase * 2.0) * 0.25;

	vec4 mv = modelViewMatrix * vec4(pos, 1.0);
	gl_Position = projectionMatrix * mv;

	float dist = length(mv.xyz);
	gl_PointSize = clamp(280.0 / dist, 1.4, 18.0);

	float flicker = 0.68 + 0.32 * sin(uTime * 3.6 + aPhase * 4.0);
	vAlpha = flicker * (0.42 + uPulse * 0.72);

	vec3 cyan = vec3(0.35, 0.95, 1.0);
	vec3 orange = vec3(1.0, 0.55, 0.18);
	vColor = mix(cyan, orange, aHue);
}
`;

const ATMOSPHERE_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;

void main() {
	vec2 uv = gl_PointCoord - 0.5;
	float d = length(uv);
	if (d > 0.5) discard;
	float core = 1.0 - smoothstep(0.0, 0.5, d);
	float glow = pow(core, 1.6);
	gl_FragColor = vec4(vColor * glow * 1.85, vAlpha * glow);
}
`;

/** Unoszące się iskry / pył neonowy nad boiskiem — additive, bez cieni. */
export function setupStadiumAtmosphere(scene: THREE.Scene): THREE.Points {
	if (rig) return rig.root;

	const positions = new Float32Array(PARTICLE_COUNT * 3);
	const velocities = new Float32Array(PARTICLE_COUNT * 3);
	const phases = new Float32Array(PARTICLE_COUNT);
	const hues = new Float32Array(PARTICLE_COUNT);

	for (let i = 0; i < PARTICLE_COUNT; i++) {
		spawnParticle(positions, velocities, phases, i);
		hues[i] = Math.random();
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
	geo.setAttribute("aHue", new THREE.BufferAttribute(hues, 1));

	const mat = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uPulse: { value: 0 },
		},
		vertexShader: ATMOSPHERE_VERT,
		fragmentShader: ATMOSPHERE_FRAG,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	});

	const points = new THREE.Points(geo, mat);
	points.name = "stadiumAtmosphere";
	points.frustumCulled = false;
	scene.add(points);

	rig = { root: points, positions, velocities, phases };
	return points;
}

export function setStadiumAtmosphereVisible(visible: boolean): void {
	if (rig) rig.root.visible = visible;
}

export function updateStadiumAtmosphere(
	timeSec: number,
	dt: number,
	pulse = 0,
): void {
	if (!rig || !rig.root.visible) return;

	const { root, positions, velocities, phases } = rig;
	const spanX = RL_ARENA.HALF_WIDTH + 48;
	const spanZ = RL_ARENA.HALF_LENGTH + 48;
	const posAttr = root.geometry.getAttribute(
		"position",
	) as THREE.BufferAttribute;

	for (let i = 0; i < PARTICLE_COUNT; i++) {
		const ix = i * 3;
		positions[ix] += velocities[ix] * dt;
		positions[ix + 1] += velocities[ix + 1] * dt;
		positions[ix + 2] += velocities[ix + 2] * dt;

		if (positions[ix + 1] > 48) {
			spawnParticle(positions, velocities, phases, i);
			positions[ix + 1] = 1.5 + Math.random() * 2;
		}
		if (Math.abs(positions[ix]) > spanX) velocities[ix] *= -1;
		if (Math.abs(positions[ix + 2]) > spanZ) velocities[ix + 2] *= -1;
	}

	posAttr.needsUpdate = true;

	const mat = root.material as THREE.ShaderMaterial;
	mat.uniforms.uTime.value = timeSec;
	mat.uniforms.uPulse.value = THREE.MathUtils.lerp(
		mat.uniforms.uPulse.value,
		pulse,
		1 - Math.exp(-6 * dt),
	);
}

export function disposeStadiumAtmosphere(): void {
	if (!rig) return;
	rig.root.geometry.dispose();
	(rig.root.material as THREE.Material).dispose();
	rig.root.removeFromParent();
	rig = null;
}
