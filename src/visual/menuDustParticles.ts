import * as THREE from "three";

const PARTICLE_COUNT = 150;
const SPREAD_X = 44;
const SPREAD_Z = 40;
const HEIGHT_MIN = 1.8;
const HEIGHT_MAX = 17;
const REPEL_RADIUS = 9;
const REPEL_STRENGTH = 16;

/** Ambientowe iskry/kurz w menu — odpychane od kursora. */
export class MenuDustParticles {
	private readonly group = new THREE.Group();
	private readonly positions: Float32Array;
	private readonly basePositions: Float32Array;
	private readonly velocities: Float32Array;
	private readonly geometry: THREE.BufferGeometry;
	private readonly points: THREE.Points;
	private readonly pointer = new THREE.Vector2();

	constructor() {
		this.positions = new Float32Array(PARTICLE_COUNT * 3);
		this.basePositions = new Float32Array(PARTICLE_COUNT * 3);
		this.velocities = new Float32Array(PARTICLE_COUNT * 3);

		for (let i = 0; i < PARTICLE_COUNT; i++) {
			const x = (Math.random() - 0.5) * SPREAD_X;
			const y = HEIGHT_MIN + Math.random() * (HEIGHT_MAX - HEIGHT_MIN);
			const z = (Math.random() - 0.5) * SPREAD_Z;
			const idx = i * 3;
			this.basePositions[idx] = x;
			this.basePositions[idx + 1] = y;
			this.basePositions[idx + 2] = z;
			this.positions[idx] = x;
			this.positions[idx + 1] = y;
			this.positions[idx + 2] = z;
		}

		this.geometry = new THREE.BufferGeometry();
		this.geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(this.positions, 3),
		);

		const material = new THREE.PointsMaterial({
			color: 0xc8e8ff,
			size: 0.14,
			transparent: true,
			opacity: 0.62,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			sizeAttenuation: true,
		});

		this.points = new THREE.Points(this.geometry, material);
		this.group.name = "menuDust";
		this.group.add(this.points);
	}

	getObject(): THREE.Group {
		return this.group;
	}

	setPointerNorm(x: number, y: number): void {
		this.pointer.set(
			THREE.MathUtils.clamp(x, -1, 1),
			THREE.MathUtils.clamp(y, -1, 1),
		);
	}

	update(dt: number, timeSec: number): void {
		const px = this.pointer.x * 20;
		const pz = this.pointer.y * 16;
		const repelRadiusSq = REPEL_RADIUS * REPEL_RADIUS;

		for (let i = 0; i < PARTICLE_COUNT; i++) {
			const idx = i * 3;
			const x = this.positions[idx]!;
			const y = this.positions[idx + 1]!;
			const z = this.positions[idx + 2]!;

			const bx = this.basePositions[idx]!;
			const by =
				this.basePositions[idx + 1]! +
				Math.sin(timeSec * 0.45 + i * 0.19) * 0.42;
			const bz = this.basePositions[idx + 2]!;

			const dx = x - px;
			const dz = z - pz;
			const distSq = dx * dx + dz * dz;
			if (distSq < repelRadiusSq && distSq > 0.02) {
				const dist = Math.sqrt(distSq);
				const force = (1 - dist / REPEL_RADIUS) * REPEL_STRENGTH * dt;
				this.velocities[idx]! += (dx / dist) * force;
				this.velocities[idx + 2]! += (dz / dist) * force;
			}

			this.velocities[idx]! += (bx - x) * 2.1 * dt;
			this.velocities[idx + 1]! += (by - y) * 2.6 * dt;
			this.velocities[idx + 2]! += (bz - z) * 2.1 * dt;

			const damp = Math.exp(-4.2 * dt);
			this.velocities[idx]! *= damp;
			this.velocities[idx + 1]! *= damp;
			this.velocities[idx + 2]! *= damp;

			this.positions[idx] = x + this.velocities[idx]! * dt;
			this.positions[idx + 1] = y + this.velocities[idx + 1]! * dt;
			this.positions[idx + 2] = z + this.velocities[idx + 2]! * dt;
		}

		const attr = this.geometry.getAttribute("position");
		if (attr) attr.needsUpdate = true;
	}

	dispose(): void {
		this.geometry.dispose();
		const mat = this.points.material;
		if (Array.isArray(mat)) {
			for (const m of mat) m.dispose();
		} else {
			mat.dispose();
		}
	}
}
