import * as THREE from "three";
import type { ScoringTeam } from "../game/modes";
import { ballPaletteForTeam } from "./ballTeamVisual";

const MAX_PARTICLES = 128;
/** RL supersonic piłki — ~2200 uu/s = 22 m/s. */
const SPEED_THRESHOLD = 16;
const SUPERSONIC_SPEED = 22;
const EMIT_BASE = 1;

const PLASMA_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;

void main() {
	vColor = aColor;
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	float dist = max(0.001, -mv.z);
	gl_PointSize = aSize * (180.0 / dist);
	gl_Position = projectionMatrix * mv;
	vAlpha = clamp(1.0 - length(position.xz) * 0.0010, 0.25, 0.92);
}
`;

const PLASMA_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
	vec2 uv = gl_PointCoord - 0.5;
	float d = length(uv);
	float core = smoothstep(0.48, 0.0, d);
	float halo = smoothstep(0.5, 0.14, d);
	vec3 col = vColor * (core * 0.75 + halo * 0.22);
	float alpha = (core * 0.42 + halo * 0.18) * vAlpha;
	if (alpha < 0.025) discard;
	gl_FragColor = vec4(col, alpha);
}
`;

type Particle = {
	life: number;
	maxLife: number;
};

/**
 * Przestrzenny ogon plazmowy piłki — THREE.Points + additive shader (stonowany pod bloom).
 */
export class PlasmaBallTrail {
	private readonly root = new THREE.Group();
	private readonly geometry = new THREE.BufferGeometry();
	private readonly positions = new Float32Array(MAX_PARTICLES * 3);
	private readonly colors = new Float32Array(MAX_PARTICLES * 3);
	private readonly sizes = new Float32Array(MAX_PARTICLES);
	private readonly particles: Particle[] = [];
	private readonly scratchVel = new THREE.Vector3();
	private readonly scratchEmit = new THREE.Vector3();
	private readonly scratchJitter = new THREE.Vector3();
	private readonly colorHead = new THREE.Color(0x44c8e8);
	private readonly colorCore = new THREE.Color(0x9ad8f0);
	private readonly colorMix = new THREE.Color();
	private writeHead = 0;
	private teamPalette = ballPaletteForTeam(null);
	private useTeamPalette = false;

	constructor(scene: THREE.Scene) {
		for (let i = 0; i < MAX_PARTICLES; i++) {
			this.particles.push({ life: 0, maxLife: 1 });
			const i3 = i * 3;
			this.positions[i3] = 0;
			this.positions[i3 + 1] = -900;
			this.positions[i3 + 2] = 0;
			this.sizes[i] = 0;
		}

		const material = new THREE.ShaderMaterial({
			vertexShader: PLASMA_VERT,
			fragmentShader: PLASMA_FRAG,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			vertexColors: true,
		});

		this.geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(this.positions, 3),
		);
		this.geometry.setAttribute(
			"aColor",
			new THREE.BufferAttribute(this.colors, 3),
		);
		this.geometry.setAttribute(
			"aSize",
			new THREE.BufferAttribute(this.sizes, 1),
		);

		const points = new THREE.Points(this.geometry, material);
		points.frustumCulled = false;
		points.renderOrder = 6;
		this.root.add(points);
		scene.add(this.root);
	}

	warmup(): void {
		for (const p of this.particles) {
			p.life = 0;
		}
		this.flushGeometry();
	}

	/** Wypełnia bufor cząsteczek — kompilacja shadera przy pierwszym draw. */
	primeGpuDraw(ballPos: THREE.Vector3, ballVel: THREE.Vector3): void {
		for (let i = 0; i < 12; i++) {
			this.update(ballPos, ballVel, 1 / 60);
		}
	}

	getDrawables(): THREE.Object3D[] {
		return [this.root];
	}

	setTeamTint(team: ScoringTeam | null): void {
		this.teamPalette = ballPaletteForTeam(team);
		this.useTeamPalette = team !== null;
		this.colorHead.setHex(this.teamPalette.trailHead);
		this.colorCore.setHex(this.teamPalette.trailCore);
	}

	update(ballPos: THREE.Vector3, ballVel: THREE.Vector3, dt: number): void {
		const speed = ballVel.length();
		const superT = THREE.MathUtils.clamp((speed - SUPERSONIC_SPEED) / 18, 0, 1);
		const t = THREE.MathUtils.clamp((speed - SPEED_THRESHOLD) / 24, 0, 1);
		const emitMul = 1 + superT * 1.35;

		if (this.useTeamPalette) {
			this.colorHead.setHex(this.teamPalette.trailHead);
			this.colorCore.setHex(this.teamPalette.trailCore);
		} else {
			this.colorHead.setHSL(0.52 + superT * 0.06, 0.78, 0.42 + t * 0.08);
			this.colorCore.setHSL(0.54 + superT * 0.04, 0.65, 0.52);
		}

		if (speed >= SPEED_THRESHOLD && dt > 0) {
			const emitCount = Math.min(7, Math.floor((EMIT_BASE + t * 4) * emitMul));
			this.scratchVel.copy(ballVel).normalize();
			for (let i = 0; i < emitCount; i++) {
				this.scratchJitter.set(
					(Math.random() - 0.5) * 0.18,
					(Math.random() - 0.5) * 0.14,
					(Math.random() - 0.5) * 0.18,
				);
				this.scratchEmit
					.copy(ballPos)
					.addScaledVector(this.scratchVel, -0.1 - Math.random() * 0.22)
					.add(this.scratchJitter);
				this.spawn(
					this.scratchEmit,
					0.18 + Math.random() * 0.16 + superT * 0.08,
					2.2 + t * 4.5 + superT * 3.2 + Math.random() * 2,
				);
			}
		}

		if (dt <= 0) return;
		for (let i = 0; i < MAX_PARTICLES; i++) {
			const p = this.particles[i]!;
			if (p.life <= 0) continue;
			p.life -= dt;
			const i3 = i * 3;
			const fade = Math.max(0, p.life / p.maxLife);
			this.sizes[i] = (1.8 + fade * 5) * (0.45 + t * 0.35 + superT * 0.25);
			this.colorMix.copy(this.colorHead).lerp(this.colorCore, fade * 0.55);
			this.colors[i3] = this.colorMix.r;
			this.colors[i3 + 1] = this.colorMix.g;
			this.colors[i3 + 2] = this.colorMix.b;
			if (p.life <= 0) {
				this.positions[i3 + 1] = -900;
				this.sizes[i] = 0;
			}
		}

		this.flushGeometry();
	}

	dispose(): void {
		this.geometry.dispose();
		const mat = (this.root.children[0] as THREE.Points)?.material;
		if (mat instanceof THREE.Material) mat.dispose();
		this.root.removeFromParent();
	}

	private spawn(pos: THREE.Vector3, life: number, size: number): void {
		const idx = this.writeHead % MAX_PARTICLES;
		this.writeHead++;

		const p = this.particles[idx]!;
		p.life = life;
		p.maxLife = life;

		const i3 = idx * 3;
		this.positions[i3] = pos.x;
		this.positions[i3 + 1] = pos.y;
		this.positions[i3 + 2] = pos.z;
		this.sizes[idx] = size;
		this.colors[i3] = this.colorHead.r;
		this.colors[i3 + 1] = this.colorHead.g;
		this.colors[i3 + 2] = this.colorHead.b;
	}

	private flushGeometry(): void {
		const pos = this.geometry.getAttribute("position") as THREE.BufferAttribute;
		const col = this.geometry.getAttribute("aColor") as THREE.BufferAttribute;
		const sz = this.geometry.getAttribute("aSize") as THREE.BufferAttribute;
		pos.needsUpdate = true;
		col.needsUpdate = true;
		sz.needsUpdate = true;
	}
}
