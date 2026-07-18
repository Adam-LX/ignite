import * as THREE from "three";

const SPARK_COUNT = 36;
const SPARK_DURATION = 0.42;

type SparkSlot = {
	active: boolean;
	life: number;
	maxLife: number;
	origin: THREE.Vector3;
	velocity: THREE.Vector3;
};

/** Iskry przy uderzeniu w słupek / poprzeczkę. */
export class PostHitSparksVfx {
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
			color: 0xffdd88,
			transparent: true,
			opacity: 1,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
		});

		this.sparkLines = new THREE.LineSegments(this.sparkGeometry, sparkMat);
		this.sparkLines.frustumCulled = false;
		this.sparkLines.renderOrder = 16;
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

	trigger(point: THREE.Vector3, impact: number): void {
		const speedScale = THREE.MathUtils.clamp(impact / 18, 0.55, 1.8);
		for (let i = 0; i < SPARK_COUNT; i++) {
			const slot = this.sparks[i]!;
			slot.active = true;
			slot.life = SPARK_DURATION * (0.55 + Math.random() * 0.55);
			slot.maxLife = slot.life;
			slot.origin.copy(point);

			const theta = Math.random() * Math.PI * 2;
			const spd = (10 + Math.random() * 22) * speedScale;
			slot.velocity.set(
				Math.cos(theta) * spd,
				4 + Math.random() * 12 * speedScale,
				Math.sin(theta) * spd,
			);
		}
	}

	update(dt: number): void {
		let anySpark = false;
		for (let i = 0; i < SPARK_COUNT; i++) {
			const slot = this.sparks[i]!;
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
			slot.velocity.multiplyScalar(Math.max(0, 1 - dt * 3.8));
			slot.velocity.y -= 20 * dt;

			const len = slot.maxLife * (0.2 + (slot.life / slot.maxLife) * 1.6);
			if (slot.velocity.lengthSq() < 1e-8) {
				slot.active = false;
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

		this.sparkGeometry.attributes.position!.needsUpdate = true;
		this.sparkLines.visible = anySpark;
		(this.sparkLines.material as THREE.LineBasicMaterial).opacity = anySpark
			? 0.96
			: 0;
	}

	dispose(): void {
		this.sparkGeometry.dispose();
		(this.sparkLines.material as THREE.Material).dispose();
		this.sparkLines.removeFromParent();
	}
}
