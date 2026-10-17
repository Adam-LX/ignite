import * as THREE from "three";

/** ON FIRE — miękka poświata przy serii goli (≥2). Bez BoxGeometry. */
export class CarStreakVfx {
	private readonly aura: THREE.Mesh;
	private readonly rim: THREE.Mesh;
	private life = 0;
	private level = 0;

	constructor(parent: THREE.Object3D, team: "blue" | "orange") {
		const color = team === "blue" ? 0x5eb8ff : 0xff8844;
		const hot = team === "blue" ? 0xa8f0ff : 0xffd080;
		const mat = new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.BackSide,
			toneMapped: false,
		});
		/** Elipsoida, nie prostopadłościan — box wyglądał jak klocek przy booscie/streak. */
		this.aura = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 14), mat);
		this.aura.scale.set(1.15, 0.42, 1.55);
		this.aura.frustumCulled = false;
		this.aura.renderOrder = 2;
		parent.add(this.aura);

		const rimMat = new THREE.MeshBasicMaterial({
			color: hot,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		this.rim = new THREE.Mesh(
			new THREE.TorusGeometry(0.72, 0.04, 8, 32),
			rimMat,
		);
		this.rim.rotation.x = Math.PI / 2;
		this.rim.position.y = 0.05;
		this.rim.frustumCulled = false;
		this.rim.renderOrder = 3;
		parent.add(this.rim);
	}

	setStreak(goalsInRow: number): void {
		if (goalsInRow >= 3) {
			this.level = 2;
			this.life = 1;
		} else if (goalsInRow >= 2) {
			this.level = 1;
			this.life = 1;
		} else {
			this.level = 0;
		}
	}

	update(dt: number): void {
		if (this.level <= 0) {
			this.life = Math.max(0, this.life - dt * 3);
		}
		const mat = this.aura.material as THREE.MeshBasicMaterial;
		const rimMat = this.rim.material as THREE.MeshBasicMaterial;
		if (this.level <= 0 && this.life <= 0.01) {
			mat.opacity = 0;
			rimMat.opacity = 0;
			this.rim.visible = false;
			this.aura.visible = false;
			return;
		}
		this.aura.visible = true;
		const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.01);
		const active = Math.max(this.life, this.level > 0 ? 1 : 0);
		const base = this.level >= 2 ? 0.28 : 0.18;
		mat.opacity = base * pulse * active;
		rimMat.opacity = (this.level >= 2 ? 0.4 : 0.28) * pulse * active;
		this.rim.visible = true;
		this.rim.rotation.z += dt * (1.8 + this.level);
		const scale = 1 + pulse * 0.06 * (this.level + 1);
		this.aura.scale.set(1.15 * scale, 0.42 * scale, 1.55 * scale);
		this.rim.scale.setScalar(0.95 + pulse * 0.12 * this.level);
	}

	dispose(): void {
		this.aura.geometry.dispose();
		(this.aura.material as THREE.Material).dispose();
		this.aura.removeFromParent();
		this.rim.geometry.dispose();
		(this.rim.material as THREE.Material).dispose();
		this.rim.removeFromParent();
	}
}
