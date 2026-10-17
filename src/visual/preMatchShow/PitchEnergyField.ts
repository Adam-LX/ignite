/**
 * Hex energy field nad murawą — prematch spektakl + lekkie pulsy w meczu.
 */
import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
	vUv = uv;
	vec4 wp = modelMatrix * vec4(position, 1.0);
	vWorld = wp.xyz;
	gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uPulse;
uniform float uDensity;
uniform float uTeamMix;
uniform float uOpacityCap;

varying vec2 vUv;
varying vec3 vWorld;

vec2 hexUv(vec2 p) {
	p = abs(p);
	return vec2(p.x * 0.866025 + p.y * 0.5, p.y);
}

float hexGrid(vec2 p, float scale) {
	vec2 gv = hexUv(p * scale);
	vec2 id = floor(gv);
	vec2 f = fract(gv) - 0.5;
	float d = max(abs(f.x) * 0.866025 + abs(f.y) * 0.5, abs(f.y));
	float line = smoothstep(0.48, 0.42, d);
	float pulse = 0.55 + 0.45 * sin(uTime * 2.2 + id.x * 0.7 + id.y * 1.1);
	return line * pulse;
}

void main() {
	float dens = clamp(uDensity, 0.0, 1.2);
	if (dens < 0.01) discard;

	vec2 p = vWorld.xz * 0.085;
	float hex = hexGrid(p, 1.0);
	float hex2 = hexGrid(p * 1.35 + vec2(0.2, -0.15), 0.7) * 0.55;

	float scan = sin(vWorld.x * 0.35 + vWorld.z * 0.22 - uTime * 3.5);
	scan = smoothstep(0.65, 1.0, scan) * 0.35;

	float radial = 1.0 - smoothstep(18.0, 48.0, length(vWorld.xz));
	float breath = 0.75 + 0.25 * sin(uTime * 1.4) + uPulse * 0.35;

	vec3 blue = vec3(0.25, 0.72, 1.0);
	vec3 orange = vec3(1.0, 0.52, 0.18);
	vec3 tint = mix(blue, orange, clamp(uTeamMix, 0.0, 1.0));
	vec3 mid = mix(tint, vec3(0.7, 0.9, 1.0), 0.35);

	float mask = (hex * 0.7 + hex2 * 0.45 + scan) * radial * breath;
	float alpha = mask * dens * 0.48 * uOpacityCap;
	alpha = clamp(alpha, 0.0, 0.55);

	/** Party dancefloor — gold/magenta punch nad blue/orange. */
	vec3 party = mix(vec3(1.15, 0.45, 1.25), vec3(1.2, 0.95, 0.25), 0.45 + 0.35 * sin(uTime * 2.5));
	vec3 hot = mix(mid, party, 0.4 + uPulse * 0.2);
	gl_FragColor = vec4(hot * (1.15 + dens * 0.55), alpha);
}
`;

export class PitchEnergyField {
	readonly root = new THREE.Group();
	private readonly mesh: THREE.Mesh;
	private readonly mat: THREE.ShaderMaterial;
	private density = 0;
	private pulse = 0;
	private teamMix = 0.5;
	private opacityCap = 1;

	constructor() {
		this.root.name = "pitchEnergyField";
		this.mat = new THREE.ShaderMaterial({
			uniforms: {
				uTime: { value: 0 },
				uPulse: { value: 0 },
				uDensity: { value: 0 },
				uTeamMix: { value: 0.5 },
				uOpacityCap: { value: 1 },
			},
			vertexShader: VERT,
			fragmentShader: FRAG,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		this.mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(
				RL_ARENA.HALF_WIDTH * 1.92,
				RL_ARENA.HALF_LENGTH * 1.92,
			),
			this.mat,
		);
		this.mesh.rotation.x = -Math.PI / 2;
		this.mesh.position.y = PLAYFIELD_SURFACE_Y + 0.08;
		this.mesh.renderOrder = 16;
		this.mesh.frustumCulled = false;
		this.root.add(this.mesh);
	}

	setOpacityCap(cap: number): void {
		this.opacityCap = THREE.MathUtils.clamp(cap, 0.15, 1);
		this.mat.uniforms.uOpacityCap!.value = this.opacityCap;
	}

	setTeamMix(mix: number): void {
		this.teamMix = THREE.MathUtils.clamp(mix, 0, 1);
	}

	/**
	 * Prematch: density z krzywej showU (jak dym).
	 * Mecz: density z atmosphere pulse.
	 */
	update(
		dt: number,
		opts: {
			densityTarget: number;
			pulse: number;
			teamMix?: number;
			timeScale?: number;
		},
	): void {
		const target = THREE.MathUtils.clamp(opts.densityTarget, 0, 1.2);
		this.density = THREE.MathUtils.lerp(
			this.density,
			target,
			1 - Math.exp(-dt * 2.6),
		);
		this.pulse = THREE.MathUtils.lerp(
			this.pulse,
			opts.pulse,
			1 - Math.exp(-dt * 4),
		);
		if (opts.teamMix !== undefined) {
			this.teamMix = THREE.MathUtils.lerp(
				this.teamMix,
				THREE.MathUtils.clamp(opts.teamMix, 0, 1),
				1 - Math.exp(-dt * 2),
			);
		}
		const u = this.mat.uniforms;
		u.uTime!.value =
			(u.uTime!.value as number) + dt * (opts.timeScale ?? 1);
		u.uPulse!.value = this.pulse;
		u.uDensity!.value = this.density;
		u.uTeamMix!.value = this.teamMix;
		u.uOpacityCap!.value = this.opacityCap;
		this.mesh.visible = this.density > 0.01;
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		this.mat.dispose();
		this.root.removeFromParent();
	}
}
