import * as THREE from "three";

const WAVE_DURATION = 0.52;

/** Cyjanowy pierścień przy epic save — defleksja bramki. */
export class EpicSaveShockwaveVfx {
	private readonly root = new THREE.Group();
	private readonly coreRing: THREE.Mesh;
	private readonly outerRing: THREE.Mesh;
	private life = 0;
	private intensity = 1;

	constructor(scene: THREE.Scene) {
		this.root.name = "epicSaveShockwave";
		scene.add(this.root);

		const coreMat = new THREE.MeshBasicMaterial({
			color: 0xd8fff8,
			transparent: true,
			opacity: 0.92,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.coreRing = new THREE.Mesh(
			new THREE.RingGeometry(0.2, 0.65, 56),
			coreMat,
		);
		this.coreRing.rotation.x = -Math.PI / 2;
		this.root.add(this.coreRing);

		const outerMat = coreMat.clone();
		outerMat.color.setHex(0x44ffdd);
		this.outerRing = new THREE.Mesh(
			new THREE.RingGeometry(0.55, 1.55, 48),
			outerMat,
		);
		this.outerRing.rotation.x = -Math.PI / 2;
		this.root.add(this.outerRing);
		this.root.visible = false;
	}

	trigger(worldPos: THREE.Vector3, impact = 8): void {
		this.intensity = THREE.MathUtils.clamp(impact / 10, 0.55, 1.35);
		this.root.position.copy(worldPos);
		this.root.position.y = Math.max(0.1, worldPos.y - 0.2);
		this.root.visible = true;
		this.life = WAVE_DURATION;
		this.coreRing.scale.setScalar(0.15);
		this.outerRing.scale.setScalar(0.12);
	}

	update(dt: number): void {
		if (this.life <= 0) {
			this.root.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / WAVE_DURATION;
		const k = this.intensity;
		const expand = 0.15 + t * (14 + k * 6);
		this.coreRing.scale.setScalar(expand);
		this.outerRing.scale.setScalar(expand * 1.22);
		const fade = (1 - t) ** 1.3;
		(this.coreRing.material as THREE.MeshBasicMaterial).opacity = 0.92 * fade;
		(this.outerRing.material as THREE.MeshBasicMaterial).opacity = 0.68 * fade;
	}

	dispose(): void {
		this.root.removeFromParent();
		this.coreRing.geometry.dispose();
		this.outerRing.geometry.dispose();
		(this.coreRing.material as THREE.Material).dispose();
		(this.outerRing.material as THREE.Material).dispose();
	}
}
