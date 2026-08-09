import * as THREE from "three";

/** Złoty pierścień przy flip resecie. */
export class FlipResetRingVfx {
	private readonly ring: THREE.Mesh;
	private life = 0;

	constructor(scene: THREE.Scene) {
		const mat = new THREE.MeshBasicMaterial({
			color: 0xffd040,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 1.1, 56), mat);
		this.ring.rotation.x = -Math.PI / 2;
		this.ring.visible = false;
		scene.add(this.ring);
	}

	trigger(worldPos: THREE.Vector3): void {
		this.ring.position.copy(worldPos);
		this.ring.position.y += 0.15;
		this.ring.visible = true;
		this.life = 0.55;
		this.ring.scale.setScalar(0.3);
	}

	update(dt: number): void {
		if (this.life <= 0) {
			this.ring.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / 0.55;
		this.ring.scale.setScalar(0.3 + t * 7);
		(this.ring.material as THREE.MeshBasicMaterial).opacity =
			0.9 * (1 - t) ** 1.3;
	}

	dispose(): void {
		this.ring.geometry.dispose();
		(this.ring.material as THREE.Material).dispose();
		this.ring.removeFromParent();
	}
}
