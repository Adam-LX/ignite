import * as THREE from "three";

const MAX_PARTICLES = 320;
const BURST_SPEED = 22;
const SECOND_WAVE_AT = 0.14;

/** Confetti + pierścień uderzeniowy przy golu. */
export class GoalVfx {
	private readonly root = new THREE.Group();
	private readonly geometry: THREE.BufferGeometry;
	private readonly positions: Float32Array;
	private readonly sizes: Float32Array;
	private readonly velocities: THREE.Vector3[] = [];
	private life = 0;
	private secondWaveFired = false;

	private readonly ringMesh: THREE.Mesh;
	private ringLife = 0;

	constructor(scene: THREE.Scene) {
		this.root.name = "goalVfx";
		scene.add(this.root);

		this.positions = new Float32Array(MAX_PARTICLES * 3);
		this.sizes = new Float32Array(MAX_PARTICLES);
		this.geometry = new THREE.BufferGeometry();
		this.geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(this.positions, 3),
		);
		this.geometry.setAttribute(
			"size",
			new THREE.BufferAttribute(this.sizes, 1),
		);

		const mat = new THREE.PointsMaterial({
			color: 0xffffff,
			size: 0.72,
			transparent: true,
			opacity: 0.98,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
		});

		const points = new THREE.Points(this.geometry, mat);
		points.frustumCulled = false;
		this.root.add(points);

		const ringMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.85,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.ringMesh = new THREE.Mesh(
			new THREE.RingGeometry(0.4, 1.2, 48),
			ringMat,
		);
		this.ringMesh.rotation.x = -Math.PI / 2;
		this.ringMesh.visible = false;
		this.root.add(this.ringMesh);
	}

	trigger(goalPos: THREE.Vector3, team: "blue" | "orange"): void {
		this.root.position.copy(goalPos);
		this.root.visible = true;
		this.life = 2.2;
		this.secondWaveFired = false;
		this.ringLife = 0.55;

		const hue = team === "blue" ? 0.55 : 0.08;
		const color = new THREE.Color().setHSL(hue, 1, 0.62);
		const pts = this.root.children[0] as THREE.Points;
		(pts.material as THREE.PointsMaterial).color.copy(color);
		(this.ringMesh.material as THREE.MeshBasicMaterial).color.copy(color);

		this.spawnBurst(0, MAX_PARTICLES, 1);
		this.ringMesh.visible = true;
		this.ringMesh.scale.setScalar(0.35);
	}

	private spawnBurst(start: number, count: number, speedMul: number): void {
		for (let i = start; i < start + count && i < MAX_PARTICLES; i++) {
			const v = new THREE.Vector3(
				(Math.random() - 0.5) * 2.4,
				Math.random() * 1.8 + 0.2,
				(Math.random() - 0.5) * 2.4,
			)
				.normalize()
				.multiplyScalar(BURST_SPEED * speedMul * (0.35 + Math.random() * 1.1));
			v.y += 4 + Math.random() * 8;

			if (i >= this.velocities.length) {
				this.velocities.push(v);
			} else {
				this.velocities[i]!.copy(v);
			}

			this.positions[i * 3] = (Math.random() - 0.5) * 0.5;
			this.positions[i * 3 + 1] = Math.random() * 0.8;
			this.positions[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
			this.sizes[i] = 0.45 + Math.random() * 0.85;
		}

		this.geometry.attributes.position!.needsUpdate = true;
		this.geometry.attributes.size!.needsUpdate = true;
	}

	update(dt: number): void {
		const elapsed = 2.2 - this.life;
		if (!this.secondWaveFired && this.life > 0 && elapsed >= SECOND_WAVE_AT) {
			this.secondWaveFired = true;
			this.spawnBurst(0, Math.floor(MAX_PARTICLES * 0.45), 0.72);
		}

		if (this.ringLife > 0) {
			this.ringLife -= dt;
			const t = 1 - this.ringLife / 0.55;
			const scale = 0.35 + t * 14;
			this.ringMesh.scale.setScalar(scale);
			(this.ringMesh.material as THREE.MeshBasicMaterial).opacity =
				0.85 * (1 - t) ** 1.6;
			if (this.ringLife <= 0) {
				this.ringMesh.visible = false;
			}
		}

		if (this.life <= 0) {
			this.root.visible = false;
			return;
		}

		this.life -= dt;
		const drag = 0.91 ** (dt * 60);

		for (let i = 0; i < this.velocities.length; i++) {
			const v = this.velocities[i];
			if (!v) continue;
			v.y -= 22 * dt;
			v.multiplyScalar(drag);

			this.positions[i * 3] += v.x * dt;
			this.positions[i * 3 + 1] += v.y * dt;
			this.positions[i * 3 + 2] += v.z * dt;
		}

		this.geometry.attributes.position!.needsUpdate = true;
		const pts = this.root.children[0] as THREE.Points;
		(pts.material as THREE.PointsMaterial).opacity = THREE.MathUtils.clamp(
			this.life / 2.2,
			0,
			1,
		);
	}
}
