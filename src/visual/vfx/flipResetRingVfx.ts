import * as THREE from "three";

/**
 * Flip-reset indicator — RL Season 22: quick local burst around the car,
 * not a long arena-wide ring. Self-facing clarity without gameplay clutter.
 */
export class FlipResetRingVfx {
	private readonly ring: THREE.Mesh;
	private life = 0;
	private maxLife = 0.38;

	constructor(scene: THREE.Scene) {
		const mat = new THREE.MeshBasicMaterial({
			color: 0xe8f4ff,
			transparent: true,
			opacity: 0.85,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.95, 48), mat);
		this.ring.rotation.x = -Math.PI / 2;
		this.ring.visible = false;
		scene.add(this.ring);
	}

	trigger(worldPos: THREE.Vector3): void {
		this.ring.position.copy(worldPos);
		this.ring.position.y += 0.12;
		this.ring.visible = true;
		this.maxLife = 0.38;
		this.life = this.maxLife;
		this.ring.scale.setScalar(0.55);
		(this.ring.material as THREE.MeshBasicMaterial).color.set(0xe8f4ff);
		(this.ring.material as THREE.MeshBasicMaterial).opacity = 0.88;
	}

	update(dt: number): void {
		if (this.life <= 0) {
			this.ring.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / this.maxLife;
		this.ring.scale.setScalar(0.55 + t * 2.1);
		(this.ring.material as THREE.MeshBasicMaterial).opacity =
			0.72 * (1 - t) ** 1.55;
		(this.ring.material as THREE.MeshBasicMaterial).color.setRGB(
			0.91 + t * 0.06,
			0.95 - t * 0.12,
			1 - t * 0.35,
		);
	}

	dispose(): void {
		this.ring.geometry.dispose();
		(this.ring.material as THREE.Material).dispose();
		this.ring.removeFromParent();
	}
}
