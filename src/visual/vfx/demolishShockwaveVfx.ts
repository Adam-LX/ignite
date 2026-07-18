import * as THREE from "three";

const WAVE_DURATION = 0.48;

/** Uderzeniowy pierścień przy demolish — szybszy i agresywniejszy niż supersonic. */
export class DemolishShockwaveVfx {
	private readonly root = new THREE.Group();
	private readonly coreRing: THREE.Mesh;
	private readonly outerRing: THREE.Mesh;
	private readonly flashRing: THREE.Mesh;
	private life = 0;
	private intensity = 1;

	constructor(scene: THREE.Scene) {
		this.root.name = "demolishShockwave";
		scene.add(this.root);

		const coreMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.95,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.coreRing = new THREE.Mesh(
			new THREE.RingGeometry(0.15, 0.55, 64),
			coreMat,
		);
		this.coreRing.rotation.x = -Math.PI / 2;
		this.root.add(this.coreRing);

		const outerMat = coreMat.clone();
		outerMat.opacity = 0.62;
		this.outerRing = new THREE.Mesh(
			new THREE.RingGeometry(0.45, 1.35, 56),
			outerMat,
		);
		this.outerRing.rotation.x = -Math.PI / 2;
		this.root.add(this.outerRing);

		const flashMat = coreMat.clone();
		flashMat.opacity = 0.38;
		this.flashRing = new THREE.Mesh(
			new THREE.RingGeometry(0.05, 2.8, 40),
			flashMat,
		);
		this.flashRing.rotation.x = -Math.PI / 2;
		this.root.add(this.flashRing);

		this.root.visible = false;
	}

	trigger(worldPos: THREE.Vector3, team: "blue" | "orange", impact = 14): void {
		const teamColor = team === "blue" ? 0x66ddff : 0xff8844;
		const hot = team === "blue" ? 0xd8f8ff : 0xffcc66;
		(this.coreRing.material as THREE.MeshBasicMaterial).color.setHex(hot);
		(this.outerRing.material as THREE.MeshBasicMaterial).color.setHex(
			teamColor,
		);
		(this.flashRing.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);

		this.intensity = THREE.MathUtils.clamp((impact - 10) / 10, 0.55, 1.45);
		this.root.position.copy(worldPos);
		this.root.position.y = Math.max(0.08, worldPos.y - 0.35);
		this.root.visible = true;
		this.life = WAVE_DURATION;

		this.coreRing.scale.setScalar(0.12);
		this.outerRing.scale.setScalar(0.1);
		this.flashRing.scale.setScalar(0.08);
		(this.coreRing.material as THREE.MeshBasicMaterial).opacity = 0.98;
		(this.outerRing.material as THREE.MeshBasicMaterial).opacity = 0.72;
		(this.flashRing.material as THREE.MeshBasicMaterial).opacity = 0.42;
	}

	update(dt: number): void {
		if (this.life <= 0) {
			this.root.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / WAVE_DURATION;
		const k = this.intensity;
		const expand = 0.12 + t * (18 + k * 8);

		this.coreRing.scale.setScalar(expand);
		this.outerRing.scale.setScalar(expand * 1.18);
		this.flashRing.scale.setScalar(expand * 1.42);

		const fade = (1 - t) ** 1.35;
		(this.coreRing.material as THREE.MeshBasicMaterial).opacity = 0.98 * fade;
		(this.outerRing.material as THREE.MeshBasicMaterial).opacity =
			0.72 * fade ** 1.2;
		(this.flashRing.material as THREE.MeshBasicMaterial).opacity =
			0.42 * fade ** 1.8;
	}

	dispose(): void {
		this.root.removeFromParent();
		for (const mesh of [this.coreRing, this.outerRing, this.flashRing]) {
			mesh.geometry.dispose();
			(mesh.material as THREE.Material).dispose();
		}
	}
}
