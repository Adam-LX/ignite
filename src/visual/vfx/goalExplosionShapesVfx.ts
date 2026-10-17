import * as THREE from "three";

export type GoalExplosionShape = "burst" | "star" | "ring" | "spiral";

/**
 * Unikalne shape’y goal explosion — mesh overlay na top of particle kit.
 */
export class GoalExplosionShapesVfx {
	private readonly root = new THREE.Group();
	private readonly star: THREE.Mesh;
	private readonly ring: THREE.Mesh;
	private readonly spiral: THREE.Mesh;
	private life = 0;
	private shape: GoalExplosionShape = "burst";

	constructor(scene: THREE.Scene) {
		this.root.name = "goalExplosionShapes";
		scene.add(this.root);

		const starGeo = new THREE.CircleGeometry(1.2, 5);
		this.star = new THREE.Mesh(
			starGeo,
			new THREE.MeshBasicMaterial({
				color: 0xffe080,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
			}),
		);
		this.star.rotation.x = -Math.PI / 2;

		this.ring = new THREE.Mesh(
			new THREE.RingGeometry(0.6, 1.35, 48),
			new THREE.MeshBasicMaterial({
				color: 0xa8f0ff,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
			}),
		);
		this.ring.rotation.x = -Math.PI / 2;

		const spiralPts: THREE.Vector3[] = [];
		for (let i = 0; i < 64; i++) {
			const t = i / 63;
			const a = t * Math.PI * 6;
			const r = 0.2 + t * 2.4;
			spiralPts.push(new THREE.Vector3(Math.cos(a) * r, t * 1.6, Math.sin(a) * r));
		}
		this.spiral = new THREE.Mesh(
			new THREE.TubeGeometry(
				new THREE.CatmullRomCurve3(spiralPts),
				64,
				0.06,
				5,
				false,
			),
			new THREE.MeshBasicMaterial({
				color: 0xff9a4a,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			}),
		);

		this.root.add(this.star, this.ring, this.spiral);
		this.root.visible = false;
	}

	trigger(
		worldPos: THREE.Vector3,
		team: "blue" | "orange",
		shape: GoalExplosionShape = "burst",
	): void {
		if (shape === "burst") return;
		this.shape = shape;
		this.root.position.copy(worldPos);
		this.root.position.y += 0.8;
		this.root.visible = true;
		this.life = 1.15;
		const tint = team === "blue" ? 0x7ec8ff : 0xffb060;
		this.star.visible = shape === "star";
		this.ring.visible = shape === "ring";
		this.spiral.visible = shape === "spiral";
		(this.star.material as THREE.MeshBasicMaterial).color.set(tint);
		(this.ring.material as THREE.MeshBasicMaterial).color.set(tint);
		(this.spiral.material as THREE.MeshBasicMaterial).color.set(tint);
		this.star.scale.setScalar(0.2);
		this.ring.scale.setScalar(0.25);
		this.spiral.scale.setScalar(0.35);
	}

	update(dt: number): void {
		if (this.life <= 0) {
			this.root.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / 1.15;
		const fade = (1 - t) ** 1.4;
		if (this.shape === "star") {
			this.star.scale.setScalar(0.2 + t * 4.5);
			this.star.rotation.z += dt * 2.2;
			(this.star.material as THREE.MeshBasicMaterial).opacity = 0.7 * fade;
		} else if (this.shape === "ring") {
			this.ring.scale.setScalar(0.25 + t * 5.5);
			(this.ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * fade;
		} else if (this.shape === "spiral") {
			this.spiral.scale.setScalar(0.35 + t * 2.8);
			this.spiral.rotation.y += dt * 3.5;
			(this.spiral.material as THREE.MeshBasicMaterial).opacity = 0.8 * fade;
		}
	}

	dispose(): void {
		this.star.geometry.dispose();
		(this.star.material as THREE.Material).dispose();
		this.ring.geometry.dispose();
		(this.ring.material as THREE.Material).dispose();
		this.spiral.geometry.dispose();
		(this.spiral.material as THREE.Material).dispose();
		this.root.removeFromParent();
	}
}

const SHAPES: GoalExplosionShape[] = ["burst", "star", "ring", "spiral"];

/** Mapowanie loadout preset → shape overlay. */
const PRESET_SHAPE: Record<string, GoalExplosionShape> = {
	default: "burst",
	pop: "ring",
	smoke: "spiral",
	fire: "star",
	nova: "ring",
};

export function pickGoalExplosionShape(seed?: number): GoalExplosionShape {
	const i =
		seed != null
			? Math.abs(Math.floor(seed)) % SHAPES.length
			: Math.floor(Math.random() * SHAPES.length);
	return SHAPES[i]!;
}

/** Shape z equipped goal explosion (preset / id). */
export function shapeForGoalExplosionId(
	explosionId: string | null | undefined,
): GoalExplosionShape {
	if (!explosionId) return "burst";
	return PRESET_SHAPE[explosionId] ?? pickGoalExplosionShape(
		explosionId.split("").reduce((a, c) => a + c.charCodeAt(0), 0),
	);
}
