import * as THREE from "three";

/** Pierścień uderzeniowy przy wejściu w supersonic. */
export class SupersonicShockwave {
	private readonly root = new THREE.Group();
	private readonly ring: THREE.Mesh;
	private readonly outerRing: THREE.Mesh;
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

		const outerMat = mat.clone();
		outerMat.color.setHex(0x66ddff);
		outerMat.opacity = 0.55;
		this.outerRing = new THREE.Mesh(
			new THREE.RingGeometry(0.8, 2.2, 48),
			outerMat,
		);
		this.outerRing.rotation.x = -Math.PI / 2;
		this.root.add(this.outerRing);
		this.root.visible = false;
	}

	trigger(worldPos: THREE.Vector3): void {
		this.root.position.copy(worldPos);
		this.root.position.y += 0.35;
		this.root.visible = true;
		this.life = 0.52;
		this.ring.scale.setScalar(0.25);
		this.outerRing.scale.setScalar(0.2);
		(this.ring.material as THREE.MeshBasicMaterial).opacity = 0.95;
		(this.outerRing.material as THREE.MeshBasicMaterial).opacity = 0.62;
	}

	update(dt: number): void {
		if (this.life <= 0) {
			this.root.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / 0.52;
		this.ring.scale.setScalar(0.25 + t * 13);
		this.outerRing.scale.setScalar(0.2 + t * 16);
		(this.ring.material as THREE.MeshBasicMaterial).opacity =
			0.95 * (1 - t) ** 1.25;
		(this.outerRing.material as THREE.MeshBasicMaterial).opacity =
			0.62 * (1 - t) ** 1.6;
	}

	dispose(): void {
		this.root.removeFromParent();
		this.ring.geometry.dispose();
		this.outerRing.geometry.dispose();
		(this.ring.material as THREE.Material).dispose();
		(this.outerRing.material as THREE.Material).dispose();
	}
}
