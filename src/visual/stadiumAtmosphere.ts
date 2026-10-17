import * as THREE from "three";

import { resolveGraphicsSettings } from "../util/graphicsProfile";
import { isPathTraceLookEnabled } from "../util/presentationPrefs";
import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "./arenaConstants";

const PARTICLE_COUNT = 2800;

type AtmosphereRig = {
	root: THREE.Points;
	positions: Float32Array;
	velocities: Float32Array;
	phases: Float32Array;
	/** Cienki volume haze — nośnik snopów jak PT medium (high only). */
	haze: THREE.Mesh;
	hazeMat: THREE.ShaderMaterial;
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
	vAlpha = flicker * (0.58 + uPulse * 0.82);

	vec3 cyan = vec3(0.42, 0.98, 1.0);
	vec3 orange = vec3(1.0, 0.6, 0.24);
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
	float glow = pow(core, 1.45);
	gl_FragColor = vec4(vColor * glow * 2.05, vAlpha * glow);
}
`;

/** Soft air medium — Normal blending, nie additive wash. */
const MATCH_HAZE_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
	vec4 worldPos = modelMatrix * vec4(position, 1.0);
	vWorldPos = worldPos.xyz;
	gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const MATCH_HAZE_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
uniform float uPulse;
uniform float uPitchY;
varying vec3 vWorldPos;

void main() {
	float h = vWorldPos.y - uPitchY;
	/** Gęstszy tuż nad murawą, zanika pod dachem — nie mydl skybox. */
	float heightBand = smoothstep(1.2, 6.0, h) * (1.0 - smoothstep(22.0, 38.0, h));
	float radial = length(vWorldPos.xz) / 95.0;
	float edgeFade = 1.0 - smoothstep(0.72, 1.05, radial);
	float breathe = 0.92 + 0.08 * sin(uTime * 0.55);
	float dens = heightBand * edgeFade * breathe * (0.85 + uPulse * 0.25);
	float alpha = uOpacity * dens;
	if (alpha < 0.002) discard;
	/** Cool fill + lekki green bounce z murawy (fake GI w powietrzu). */
	vec3 col = mix(vec3(0.1, 0.15, 0.26), vec3(0.32, 0.5, 0.7), clamp(h / 28.0, 0.0, 1.0));
	gl_FragColor = vec4(col, alpha);
}
`;

function createMatchHaze(): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
	const mat = new THREE.ShaderMaterial({
		uniforms: {
			uOpacity: { value: 0 },
			uTime: { value: 0 },
			uPulse: { value: 0 },
			uPitchY: { value: PLAYFIELD_SURFACE_Y },
		},
		vertexShader: MATCH_HAZE_VERT,
		fragmentShader: MATCH_HAZE_FRAG,
		transparent: true,
		depthWrite: false,
		depthTest: true,
		side: THREE.DoubleSide,
		blending: THREE.NormalBlending,
		fog: false,
	});
	const mesh = new THREE.Mesh(
		new THREE.SphereGeometry(98, 28, 16),
		mat,
	);
	mesh.name = "matchAirHaze";
	mesh.position.y = PLAYFIELD_SURFACE_Y + 14;
	mesh.scale.set(1.05, 0.42, 1.12);
	mesh.renderOrder = 1;
	mesh.frustumCulled = false;
	mesh.visible = false;
	return { mesh, mat };
}

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

	const { mesh: haze, mat: hazeMat } = createMatchHaze();
	scene.add(haze);

	rig = { root: points, positions, velocities, phases, haze, hazeMat };
	return points;
}

export function setStadiumAtmosphereVisible(visible: boolean): void {
	if (!rig) return;
	rig.root.visible = visible;
	if (!visible) {
		rig.haze.visible = false;
		rig.hazeMat.uniforms.uOpacity!.value = 0;
	}
}

export function updateStadiumAtmosphere(
	timeSec: number,
	dt: number,
	pulse = 0,
): void {
	if (!rig || !rig.root.visible) return;

	const { root, positions, velocities, phases, haze, hazeMat } = rig;
	const spanX = RL_ARENA.HALF_WIDTH + 48;
	const spanZ = RL_ARENA.HALF_LENGTH + 48;
	const posAttr = root.geometry.getAttribute(
		"position",
	) as THREE.BufferAttribute;

	for (let i = 0; i < PARTICLE_COUNT; i++) {
		const ix = i * 3;
		positions[ix] += velocities[ix]! * dt;
		positions[ix + 1] += velocities[ix + 1]! * dt;
		positions[ix + 2] += velocities[ix + 2]! * dt;

		if (positions[ix + 1]! > 48) {
			spawnParticle(positions, velocities, phases, i);
			positions[ix + 1] = 1.5 + Math.random() * 2;
		}
		if (Math.abs(positions[ix]!) > spanX) velocities[ix]! *= -1;
		if (Math.abs(positions[ix + 2]!) > spanZ) velocities[ix + 2]! *= -1;
	}

	posAttr.needsUpdate = true;

	const mat = root.material as THREE.ShaderMaterial;
	mat.uniforms.uTime!.value = timeSec;
	mat.uniforms.uPulse!.value = THREE.MathUtils.lerp(
		mat.uniforms.uPulse!.value as number,
		pulse,
		1 - Math.exp(-6 * dt),
	);

	/** Path-trace air: thin haze only on high — carries jupiter shafts. */
	const q = resolveGraphicsSettings().quality;
	const pt = isPathTraceLookEnabled();
	let hazeTarget =
		q === "high" ? 0.014 + pulse * 0.008 : q === "medium" ? 0.008 : 0;
	if (!pt) hazeTarget *= 0.35;
	haze.visible = hazeTarget > 0.008;
	hazeMat.uniforms.uOpacity!.value = THREE.MathUtils.lerp(
		hazeMat.uniforms.uOpacity!.value as number,
		hazeTarget,
		1 - Math.exp(-4 * dt),
	);
	hazeMat.uniforms.uTime!.value = timeSec;
	hazeMat.uniforms.uPulse!.value = mat.uniforms.uPulse!.value;
}

export function disposeStadiumAtmosphere(): void {
	if (!rig) return;
	rig.root.geometry.dispose();
	(rig.root.material as THREE.Material).dispose();
	rig.root.removeFromParent();
	rig.haze.geometry.dispose();
	rig.hazeMat.dispose();
	rig.haze.removeFromParent();
	rig = null;
}
