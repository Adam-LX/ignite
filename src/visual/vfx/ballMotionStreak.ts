import * as THREE from "three";

const STREAK_SPEED_ON = 14;
const STREAK_SPEED_FULL = 34;

/** Kinetyczny smug za piłką — per-object motion blur bez pełnego post-process. */
export class BallMotionStreak {
	private readonly root = new THREE.Group();
	private readonly mesh: THREE.Mesh;
	private readonly axis = new THREE.Vector3(0, 1, 0);
	private readonly lookQuat = new THREE.Quaternion();
	private readonly velDir = new THREE.Vector3();
	private powerBoostLife = 0;
	private powerBoostK = 1;

	constructor(scene: THREE.Scene) {
		this.root.name = "ballMotionStreak";
		scene.add(this.root);

		const mat = new THREE.MeshBasicMaterial({
			color: 0xa8f4ff,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.mesh = new THREE.Mesh(
			new THREE.CylinderGeometry(0.08, 0.42, 1, 10, 1, true),
			mat,
		);
		this.mesh.rotation.x = Math.PI / 2;
		this.root.add(this.mesh);
	}

	setTeamColor(hex: number): void {
		(this.mesh.material as THREE.MeshBasicMaterial).color.setHex(hex);
	}

	/** Krótki boost smugi po power shot. */
	triggerPowerShotBoost(impact: number): void {
		this.powerBoostLife = 0.52;
		this.powerBoostK = THREE.MathUtils.clamp(
			1.15 + (impact - 14) / 18,
			1.15,
			1.85,
		);
	}

	update(pos: THREE.Vector3, vel: THREE.Vector3, dt: number): void {
		if (this.powerBoostLife > 0) {
			this.powerBoostLife = Math.max(0, this.powerBoostLife - dt);
		}
		const boost =
			this.powerBoostLife > 0
				? THREE.MathUtils.lerp(1, this.powerBoostK, this.powerBoostLife / 0.52)
				: 1;
		const speed = vel.length();
		const mat = this.mesh.material as THREE.MeshBasicMaterial;
		if (speed < STREAK_SPEED_ON) {
			mat.opacity = THREE.MathUtils.lerp(
				mat.opacity,
				0,
				1 - Math.exp(-14 * dt),
			);
			return;
		}

		const t = THREE.MathUtils.clamp(
			(speed - STREAK_SPEED_ON) / (STREAK_SPEED_FULL - STREAK_SPEED_ON),
			0,
			1,
		);
		const length = (0.55 + t * 2.8) * boost;
		this.mesh.scale.set(
			(0.65 + t * 0.55) * boost,
			length,
			(0.65 + t * 0.55) * boost,
		);
		this.root.position.copy(pos);

		this.velDir.copy(vel).normalize();
		this.lookQuat.setFromUnitVectors(this.axis, this.velDir);
		this.root.quaternion.copy(this.lookQuat);
		this.root.position.addScaledVector(this.velDir, -length * 0.42);

		const targetOpacity = (0.22 + t * 0.58) * boost;
		mat.opacity = THREE.MathUtils.lerp(
			mat.opacity,
			targetOpacity,
			1 - Math.exp(-18 * dt),
		);
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		(this.mesh.material as THREE.Material).dispose();
		this.root.removeFromParent();
	}
}
