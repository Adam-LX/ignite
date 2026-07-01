import * as THREE from "three";

/** Pierścień uderzeniowy przy wejściu w supersonic. */
export class SupersonicShockwave {
	private readonly root = new THREE.Group();
	private readonly ring: THREE.Mesh;
	private life = 0;

	constructor(scene: THREE.Scene) {
		this.root.name = "supersonicShockwave";
		scene.add(this.root);

		const mat = new THREE.MeshBasicMaterial({
			color: 0x9efcff,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1.4, 56), mat);
		this.ring.rotation.x = -Math.PI / 2;
		this.root.add(this.ring);
		this.root.visible = false;
	}

	trigger(worldPos: THREE.Vector3): void {
		this.root.position.copy(worldPos);
		this.root.position.y += 0.35;
		this.root.visible = true;
		this.life = 0.42;
		this.ring.scale.setScalar(0.25);
		(this.ring.material as THREE.MeshBasicMaterial).opacity = 0.92;
	}

	update(dt: number): void {
		if (this.life <= 0) {
			this.root.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / 0.42;
		const scale = 0.25 + t * 11;
		this.ring.scale.setScalar(scale);
		(this.ring.material as THREE.MeshBasicMaterial).opacity =
			0.92 * (1 - t) ** 1.35;
	}

	dispose(): void {
		this.root.removeFromParent();
		this.ring.geometry.dispose();
		(this.ring.material as THREE.Material).dispose();
	}
}
