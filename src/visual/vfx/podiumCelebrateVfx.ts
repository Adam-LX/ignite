import * as THREE from "three";

import { GoalConfettiVfx } from "./goalConfettiVfx";

/**
 * Celebracja podium — confetti + soft burst rings przy lineupie.
 */
export class PodiumCelebrateVfx {
	private readonly confetti: GoalConfettiVfx;
	private readonly rings: THREE.Mesh[] = [];
	private ringLife = 0;
	private readonly center = new THREE.Vector3(0, 1.2, 0);

	constructor(scene: THREE.Scene) {
		this.confetti = new GoalConfettiVfx(scene);
		for (let i = 0; i < 2; i++) {
			const mat = new THREE.MeshBasicMaterial({
				color: i === 0 ? 0xffe080 : 0x7ec8ff,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
				toneMapped: false,
			});
			const ring = new THREE.Mesh(
				new THREE.RingGeometry(0.6, 1.4, 48),
				mat,
			);
			ring.rotation.x = -Math.PI / 2;
			ring.visible = false;
			ring.frustumCulled = false;
			scene.add(ring);
			this.rings.push(ring);
		}
	}

	trigger(team: "blue" | "orange", at?: THREE.Vector3): void {
		this.center.copy(at ?? { x: 0, y: 1.2, z: 0 });
		this.confetti.trigger(this.center, team);
		this.ringLife = 1.4;
		const tint = team === "blue" ? 0x7ec8ff : 0xffb060;
		for (let i = 0; i < this.rings.length; i++) {
			const ring = this.rings[i]!;
			ring.position.copy(this.center);
			ring.position.y = 0.05;
			ring.visible = true;
			ring.scale.setScalar(0.3);
			(ring.material as THREE.MeshBasicMaterial).color.set(
				i === 0 ? 0xffe080 : tint,
			);
		}
	}

	update(dt: number): void {
		this.confetti.update(dt);
		if (this.ringLife <= 0) {
			for (const ring of this.rings) ring.visible = false;
			return;
		}
		this.ringLife -= dt;
		const t = 1 - this.ringLife / 1.4;
		for (let i = 0; i < this.rings.length; i++) {
			const ring = this.rings[i]!;
			const local = THREE.MathUtils.clamp(t - i * 0.18, 0, 1);
			ring.scale.setScalar(0.3 + local * (6 + i * 2));
			(ring.material as THREE.MeshBasicMaterial).opacity =
				0.65 * (1 - local) ** 1.4;
			ring.visible = local < 1;
		}
	}

	dispose(): void {
		this.confetti.dispose();
		for (const ring of this.rings) {
			ring.geometry.dispose();
			(ring.material as THREE.Material).dispose();
			ring.removeFromParent();
		}
	}
}
