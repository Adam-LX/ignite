import * as THREE from "three";

/** ON FIRE — pulsująca obwódka / poświata przy serii goli (≥2). */
export class CarStreakVfx {
	private readonly aura: THREE.Mesh;
	private life = 0;
	private level = 0;

	constructor(parent: THREE.Object3D, team: "blue" | "orange") {
		const color = team === "blue" ? 0x5eb8ff : 0xff8844;
		const mat = new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.BackSide,
		});
		this.aura = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.42, 1.65), mat);
		this.aura.frustumCulled = false;
		this.aura.renderOrder = 2;
		parent.add(this.aura);
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
		if (this.level <= 0 && this.life <= 0.01) {
			mat.opacity = 0;
			return;
		}
		const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
		const base = this.level >= 2 ? 0.28 : 0.18;
		mat.opacity = base * pulse * Math.max(this.life, this.level > 0 ? 1 : 0);
		const scale = 1 + pulse * 0.06 * (this.level + 1);
		this.aura.scale.setScalar(scale);
	}

	dispose(): void {
		this.aura.geometry.dispose();
		(this.aura.material as THREE.Material).dispose();
		this.aura.removeFromParent();
	}
}
