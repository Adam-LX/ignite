import * as THREE from "three";

const SPARK_COUNT = 40;
const SPARK_DURATION = 0.38;

type SparkSlot = {
	active: boolean;
	life: number;
	maxLife: number;
	origin: THREE.Vector3;
	velocity: THREE.Vector3;
};

/**
 * Neonowe iskry przy uderzeniu auta w piłkę — bez PointLight (bloom + RTX = hang).
 */
export class HitVfx {
	private readonly sparkLines: THREE.LineSegments;
	private readonly sparkGeometry: THREE.BufferGeometry;
	private readonly sparkPositions: Float32Array;
	private readonly sparks: SparkSlot[] = [];
	private readonly _scratch = new THREE.Vector3();

	constructor(scene: THREE.Scene) {
		this.sparkPositions = new Float32Array(SPARK_COUNT * 6);
		this.sparkGeometry = new THREE.BufferGeometry();
		this.sparkGeometry.setAttribute(
			"position",
			new THREE.BufferAttribute(this.sparkPositions, 3),
		);

		const sparkMat = new THREE.LineBasicMaterial({
			color: 0x00ffcc,
			transparent: true,
			opacity: 1,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
		});

		this.sparkLines = new THREE.LineSegments(this.sparkGeometry, sparkMat);
		this.sparkLines.frustumCulled = false;
		this.sparkLines.renderOrder = 15;
		scene.add(this.sparkLines);

		for (let i = 0; i < SPARK_COUNT; i++) {
			this.sparks.push({
				active: false,
				life: 0,
				maxLife: 0,
				origin: new THREE.Vector3(),
				velocity: new THREE.Vector3(),
			});
		}
	}

	warmup(): void {
		this.clearGpuWarmup();
	}

	primeGpuDraw(point: THREE.Vector3): THREE.Object3D {
		this.trigger(point, 28);
		this.update(1 / 60);
		this.sparkLines.visible = true;
		return this.sparkLines;
	}

	clearGpuWarmup(): void {
		const hidden = new THREE.Vector3(0, -800, 0);
		const mat = this.sparkLines.material as THREE.LineBasicMaterial;
		const prevOpacity = mat.opacity;
		mat.opacity = 0;
		this.trigger(hidden, 24);
		this.update(0.001);
		for (const slot of this.sparks) {
			slot.active = false;
		}
		this.sparkLines.visible = false;
		mat.opacity = prevOpacity;
	}

	trigger(point: THREE.Vector3, impact: number): void {
		if (impact < 3.2) return;

		const speedScale = THREE.MathUtils.clamp(impact / 20, 0.4, 2.6);
		for (let i = 0; i < SPARK_COUNT; i++) {
			const slot = this.sparks[i];
			slot.active = true;
			slot.life = SPARK_DURATION * (0.65 + Math.random() * 0.5);
			slot.maxLife = slot.life;
			slot.origin.copy(point);

			const theta = Math.random() * Math.PI * 2;
			const phi = Math.acos(2 * Math.random() - 1);
			const spd = (14 + Math.random() * 28) * speedScale;
			slot.velocity.set(
				Math.sin(phi) * Math.cos(theta) * spd,
				Math.abs(Math.cos(phi)) * spd * 0.85 + 4,
				Math.sin(phi) * Math.sin(theta) * spd,
			);
		}
	}

	update(dt: number): void {
		let anySpark = false;
		for (let i = 0; i < SPARK_COUNT; i++) {
			const slot = this.sparks[i];
			const base = i * 6;
			if (!slot.active || slot.life <= 0) {
				this.sparkPositions[base] =
					this.sparkPositions[base + 1] =
					this.sparkPositions[base + 2] =
					this.sparkPositions[base + 3] =
					this.sparkPositions[base + 4] =
					this.sparkPositions[base + 5] =
						0;
				continue;
			}

			slot.life -= dt;
			if (slot.life <= 0) {
				slot.active = false;
				continue;
			}

			anySpark = true;
			slot.origin.addScaledVector(slot.velocity, dt);
			slot.velocity.multiplyScalar(Math.max(0, 1 - dt * 4.5));
			slot.velocity.y -= 18 * dt;

			const len = slot.maxLife * (0.25 + (slot.life / slot.maxLife) * 1.8);
			if (slot.velocity.lengthSq() < 1e-8) {
				slot.active = false;
				this.sparkPositions[base] =
					this.sparkPositions[base + 1] =
					this.sparkPositions[base + 2] =
					this.sparkPositions[base + 3] =
					this.sparkPositions[base + 4] =
					this.sparkPositions[base + 5] =
						0;
				continue;
			}
			this._scratch.copy(slot.velocity).normalize().multiplyScalar(len);

			this.sparkPositions[base] = slot.origin.x;
			this.sparkPositions[base + 1] = slot.origin.y;
			this.sparkPositions[base + 2] = slot.origin.z;
			this.sparkPositions[base + 3] = slot.origin.x + this._scratch.x;
			this.sparkPositions[base + 4] = slot.origin.y + this._scratch.y;
			this.sparkPositions[base + 5] = slot.origin.z + this._scratch.z;
		}

		this.sparkGeometry.attributes.position.needsUpdate = true;
		this.sparkLines.visible = anySpark;

		const mat = this.sparkLines.material as THREE.LineBasicMaterial;
		mat.opacity = anySpark ? 0.95 : 0;
	}

	dispose(): void {
		this.sparkGeometry.dispose();
		(this.sparkLines.material as THREE.Material).dispose();
		this.sparkLines.removeFromParent();
	}
}
