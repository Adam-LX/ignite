import * as THREE from "three";

import { ExplosionKit } from "./explosionKit";

const MAX_PARTICLES = 480;
const LIFE_SEC = 2.4;
const BURST_SPEED = 28;
const SECOND_WAVE_AT = 0.1;
const THIRD_WAVE_AT = 0.28;

const enum ParticleKind {
	Spark = 0,
	Ember = 1,
	Smoke = 2,
}

type ParticleSim = {
	vx: number;
	vy: number;
	vz: number;
	life: number;
	maxLife: number;
	kind: ParticleKind;
};

const GOAL_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;

void main() {
	vColor = aColor;
	vAlpha = aAlpha;
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	float dist = max(0.001, -mv.z);
	gl_PointSize = aSize * (200.0 / dist);
	gl_Position = projectionMatrix * mv;
}
`;

const GOAL_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
	vec2 uv = gl_PointCoord - 0.5;
	float d = length(uv);
	float core = smoothstep(0.32, 0.0, d);
	float glow = smoothstep(0.55, 0.04, d);
	float halo = smoothstep(0.5, 0.18, d);
	float alpha = (core * 0.92 + glow * 0.38 + halo * 0.12) * vAlpha;
	if (alpha < 0.014) discard;
	vec3 col = vColor * (0.75 + core * 0.7 + glow * 0.35);
	col += vec3(1.0) * core * 0.22;
	gl_FragColor = vec4(col, alpha);
}
`;

/** Burst przy golu — iskry, żar, dym (lokalnie przy bramce, bez rozlewu bloom). */
export class GoalVfx {
	private readonly root = new THREE.Group();
	private readonly geometry: THREE.BufferGeometry;
	private readonly positions: Float32Array;
	private readonly colors: Float32Array;
	private readonly sizes: Float32Array;
	private readonly alphas: Float32Array;
	private readonly sims: ParticleSim[] = [];
	private readonly pointsMat: THREE.ShaderMaterial;
	private readonly points: THREE.Points;
	private life = 0;
	private secondWaveFired = false;
	private thirdWaveFired = false;

	private readonly flashMesh: THREE.Mesh;
	private flashLife = 0;

	private readonly ringMesh: THREE.Mesh;
	private readonly ringMesh2: THREE.Mesh;
	private ringLife = 0;
	private ring2Life = 0;
	private readonly explosion: ExplosionKit;

	constructor(scene: THREE.Scene) {
		this.root.name = "goalVfx";
		scene.add(this.root);
		this.explosion = new ExplosionKit(scene);

		this.positions = new Float32Array(MAX_PARTICLES * 3);
		this.colors = new Float32Array(MAX_PARTICLES * 3);
		this.sizes = new Float32Array(MAX_PARTICLES);
		this.alphas = new Float32Array(MAX_PARTICLES);

		this.geometry = new THREE.BufferGeometry();
		this.geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(this.positions, 3),
		);
		this.geometry.setAttribute(
			"aSize",
			new THREE.BufferAttribute(this.sizes, 1),
		);
		this.geometry.setAttribute(
			"aColor",
			new THREE.BufferAttribute(this.colors, 3),
		);
		this.geometry.setAttribute(
			"aAlpha",
			new THREE.BufferAttribute(this.alphas, 1),
		);

		this.pointsMat = new THREE.ShaderMaterial({
			vertexShader: GOAL_VERT,
			fragmentShader: GOAL_FRAG,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});

		this.points = new THREE.Points(this.geometry, this.pointsMat);
		this.points.frustumCulled = false;
		this.root.add(this.points);

		const flashMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		this.flashMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16), flashMat);
		this.flashMesh.visible = false;
		this.root.add(this.flashMesh);

		const ringMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.72,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.ringMesh = new THREE.Mesh(
			new THREE.RingGeometry(0.55, 1.65, 64),
			ringMat,
		);
		this.ringMesh.rotation.x = -Math.PI / 2;
		this.ringMesh.visible = false;
		this.root.add(this.ringMesh);

		const ring2Mat = ringMat.clone();
		this.ringMesh2 = new THREE.Mesh(
			new THREE.RingGeometry(0.25, 1.05, 48),
			ring2Mat,
		);
		this.ringMesh2.rotation.x = -Math.PI / 2;
		this.ringMesh2.visible = false;
		this.root.add(this.ringMesh2);

		this.clearParticles();
	}

	trigger(goalPos: THREE.Vector3, team: "blue" | "orange"): void {
		this.root.position.copy(goalPos);
		this.root.visible = true;
		this.life = LIFE_SEC;
		this.secondWaveFired = false;
		this.thirdWaveFired = false;
		this.ringLife = 0.62;
		this.ring2Life = 0.42;
		this.flashLife = 0.22;

		const hue = team === "blue" ? 0.55 : 0.08;
		const teamColor = new THREE.Color().setHSL(hue, 0.95, 0.62);
		const hotColor = new THREE.Color(0xfff0d8);
		const sparkColor = new THREE.Color(0xffffff);

		(this.ringMesh.material as THREE.MeshBasicMaterial).color.copy(teamColor);
		(this.ringMesh2.material as THREE.MeshBasicMaterial).color.copy(hotColor);
		(this.flashMesh.material as THREE.MeshBasicMaterial).color.copy(hotColor);

		this.clearParticles();
		this.spawnBurst(0, Math.floor(MAX_PARTICLES * 0.58), 1, teamColor, hotColor, sparkColor);
		this.ringMesh.visible = true;
		this.explosion.trigger(goalPos, "goal", teamColor);
		this.ringMesh.scale.setScalar(0.22);
		this.ringMesh2.visible = true;
		this.ringMesh2.scale.setScalar(0.45);
		this.flashMesh.visible = true;
		this.flashMesh.scale.setScalar(0.25);
		(this.flashMesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
	}

	private clearParticles(): void {
		for (let i = 0; i < MAX_PARTICLES; i++) {
			this.positions[i * 3 + 1] = -900;
			this.alphas[i] = 0;
			this.sizes[i] = 0;
			if (this.sims[i]) {
				this.sims[i]!.life = 0;
			}
		}
		this.geometry.attributes.position!.needsUpdate = true;
		this.geometry.attributes.aAlpha!.needsUpdate = true;
		this.geometry.attributes.aSize!.needsUpdate = true;
	}

	private spawnBurst(
		start: number,
		count: number,
		speedMul: number,
		teamColor: THREE.Color,
		hotColor: THREE.Color,
		sparkColor: THREE.Color,
	): void {
		for (let i = start; i < start + count && i < MAX_PARTICLES; i++) {
			const roll = Math.random();
			const kind =
				roll < 0.42
					? ParticleKind.Spark
					: roll < 0.78
						? ParticleKind.Ember
						: ParticleKind.Smoke;

			const dir = new THREE.Vector3(
				(Math.random() - 0.5) * 2,
				Math.random() * 0.65 + 0.05,
				(Math.random() - 0.5) * 2,
			).normalize();

			let speed = BURST_SPEED * speedMul;
			let maxLife = 1.4;
			let size = 1.1;
			const mix = new THREE.Color();

			switch (kind) {
				case ParticleKind.Spark:
					speed *= 0.85 + Math.random() * 1.35;
					maxLife = 0.35 + Math.random() * 0.55;
					size = 0.35 + Math.random() * 0.75;
					mix.copy(sparkColor).lerp(hotColor, Math.random() * 0.55);
					dir.y += 0.25 + Math.random() * 0.45;
					dir.normalize();
					break;
				case ParticleKind.Ember:
					speed *= 0.45 + Math.random() * 0.95;
					maxLife = 0.9 + Math.random() * 1.35;
					size = 0.65 + Math.random() * 1.35;
					mix.copy(hotColor).lerp(teamColor, 0.35 + Math.random() * 0.45);
					dir.y += 0.55 + Math.random() * 0.85;
					dir.normalize();
					break;
				default:
					speed *= 0.18 + Math.random() * 0.42;
					maxLife = 1.8 + Math.random() * 1.25;
					size = 1.8 + Math.random() * 2.8;
					mix.setHSL(0.08, 0.08, 0.42 + Math.random() * 0.18);
					dir.y = 0.65 + Math.random() * 0.55;
					dir.x *= 0.55;
					dir.z *= 0.55;
					dir.normalize();
					break;
			}

			const sim: ParticleSim = {
				vx: dir.x * speed,
				vy: dir.y * speed,
				vz: dir.z * speed,
				life: maxLife,
				maxLife,
				kind,
			};
			if (i >= this.sims.length) {
				this.sims.push(sim);
			} else {
				this.sims[i] = sim;
			}

			this.positions[i * 3] = (Math.random() - 0.5) * 0.35;
			this.positions[i * 3 + 1] = Math.random() * 0.45;
			this.positions[i * 3 + 2] = (Math.random() - 0.5) * 0.35;
			this.colors[i * 3] = mix.r;
			this.colors[i * 3 + 1] = mix.g;
			this.colors[i * 3 + 2] = mix.b;
			this.sizes[i] = size;
			this.alphas[i] = 1;
		}

		this.geometry.attributes.position!.needsUpdate = true;
		this.geometry.attributes.aColor!.needsUpdate = true;
		this.geometry.attributes.aSize!.needsUpdate = true;
		this.geometry.attributes.aAlpha!.needsUpdate = true;
	}

	private updateRing(
		mesh: THREE.Mesh,
		life: number,
		duration: number,
		maxScale: number,
		startScale: number,
	): number {
		if (life <= 0) {
			mesh.visible = false;
			return 0;
		}
		const t = 1 - life / duration;
		mesh.scale.setScalar(startScale + t * maxScale);
		(mesh.material as THREE.MeshBasicMaterial).opacity =
			0.72 * (1 - t) ** 1.65;
		return life;
	}

	reset(): void {
		this.life = 0;
		this.ringLife = 0;
		this.ring2Life = 0;
		this.flashLife = 0;
		this.secondWaveFired = false;
		this.thirdWaveFired = false;
		this.root.visible = false;
		this.ringMesh.visible = false;
		this.ringMesh2.visible = false;
		this.flashMesh.visible = false;
		this.clearParticles();
	}

	update(dt: number): void {
		this.explosion.update(dt);
		const elapsed = LIFE_SEC - this.life;
		if (!this.secondWaveFired && this.life > 0 && elapsed >= SECOND_WAVE_AT) {
			this.secondWaveFired = true;
			const teamColor = (this.ringMesh.material as THREE.MeshBasicMaterial).color;
			this.spawnBurst(
				0,
				Math.floor(MAX_PARTICLES * 0.32),
				0.78,
				teamColor,
				new THREE.Color(0xffe8c8),
				new THREE.Color(0xffffff),
			);
		}
		if (!this.thirdWaveFired && this.life > 0 && elapsed >= THIRD_WAVE_AT) {
			this.thirdWaveFired = true;
			const teamColor = (this.ringMesh.material as THREE.MeshBasicMaterial).color;
			this.spawnBurst(
				Math.floor(MAX_PARTICLES * 0.38),
				Math.floor(MAX_PARTICLES * 0.28),
				1.05,
				teamColor,
				new THREE.Color(0xfff0d0),
				new THREE.Color(0xffffff),
			);
		}

		if (this.ringLife > 0) {
			this.ringLife -= dt;
			this.updateRing(this.ringMesh, this.ringLife, 0.62, 18, 0.22);
		}
		if (this.ring2Life > 0) {
			this.ring2Life -= dt;
			this.updateRing(this.ringMesh2, this.ring2Life, 0.42, 12, 0.45);
		}

		if (this.flashLife > 0) {
			this.flashLife -= dt;
			const t = 1 - this.flashLife / 0.22;
			const flashMat = this.flashMesh.material as THREE.MeshBasicMaterial;
			if (t < 0.35) {
				const u = t / 0.35;
				this.flashMesh.scale.setScalar(0.25 + u * 2.8);
				flashMat.opacity = 0.85 * (1 - u * 0.55);
			} else {
				const u = (t - 0.35) / 0.65;
				this.flashMesh.scale.setScalar(3.05 + u * 1.2);
				flashMat.opacity = 0.38 * (1 - u) ** 2;
			}
		} else {
			this.flashMesh.visible = false;
			(this.flashMesh.material as THREE.MeshBasicMaterial).opacity = 0;
		}

		if (this.life <= 0) {
			this.root.visible = false;
			this.clearParticles();
			return;
		}

		this.life -= dt;

		for (let i = 0; i < MAX_PARTICLES; i++) {
			const sim = this.sims[i];
			if (!sim || sim.life <= 0) {
				this.alphas[i] = 0;
				this.positions[i * 3 + 1] = -900;
				continue;
			}

			sim.life -= dt;
			const lifeT = THREE.MathUtils.clamp(sim.life / sim.maxLife, 0, 1);

			let gravity = -16;
			let drag = 0.9 ** (dt * 60);
			if (sim.kind === ParticleKind.Spark) {
				gravity = -22;
				drag = 0.86 ** (dt * 60);
			} else if (sim.kind === ParticleKind.Smoke) {
				gravity = -1.8;
				sim.vy += 2.4 * dt;
				drag = 0.94 ** (dt * 60);
			}

			sim.vy += gravity * dt;
			sim.vx *= drag;
			sim.vy *= drag;
			sim.vz *= drag;

			this.positions[i * 3] += sim.vx * dt;
			this.positions[i * 3 + 1] += sim.vy * dt;
			this.positions[i * 3 + 2] += sim.vz * dt;

			if (sim.kind === ParticleKind.Smoke) {
				this.alphas[i] = lifeT ** 0.55 * 0.38;
				this.sizes[i] = (1.8 + (1 - lifeT) * 2.2) * 1.15;
			} else if (sim.kind === ParticleKind.Spark) {
				this.alphas[i] = lifeT ** 1.8;
				this.sizes[i] *= 0.998;
			} else {
				this.alphas[i] = lifeT ** 1.15 * 0.88;
			}
		}

		this.geometry.attributes.position!.needsUpdate = true;
		this.geometry.attributes.aSize!.needsUpdate = true;
		this.geometry.attributes.aAlpha!.needsUpdate = true;
	}
}
