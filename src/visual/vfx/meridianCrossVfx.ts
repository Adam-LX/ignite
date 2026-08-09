import * as THREE from "three";

import type { ScoringTeam } from "../../game/modes";

const LIFE = 0.45;

type Burst = {
	mesh: THREE.Mesh;
	life: number;
	maxLife: number;
};

/** Krótki ring na równiku przy przecięciu linii środkowej. */
export class MeridianCrossVfx {
	private readonly root = new THREE.Group();
	private readonly bursts: Burst[] = [];
	private readonly geo = new THREE.RingGeometry(0.6, 2.4, 48);

	constructor(scene: THREE.Scene) {
		this.root.name = "meridianCrossVfx";
		scene.add(this.root);
	}

	trigger(x: number, y: number, _z: number, team: ScoringTeam): void {
		const color = team === "blue" ? 0x44e8ff : 0xff8844;
		const mat = new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0.95,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		const mesh = new THREE.Mesh(this.geo, mat);
		mesh.rotation.x = -Math.PI / 2;
		mesh.position.set(x, Math.max(0.08, y * 0.15 + 0.12), 0);
		mesh.renderOrder = 20;
		this.root.add(mesh);
		this.bursts.push({ mesh, life: LIFE, maxLife: LIFE });
	}

	update(dt: number): void {
		for (let i = this.bursts.length - 1; i >= 0; i--) {
			const b = this.bursts[i]!;
			b.life -= dt;
			const t = 1 - Math.max(0, b.life) / b.maxLife;
			const scale = 1 + t * 3.2;
			b.mesh.scale.set(scale, scale, 1);
			const mat = b.mesh.material as THREE.MeshBasicMaterial;
			mat.opacity = (1 - t) * 0.95;
			if (b.life <= 0) {
				b.mesh.removeFromParent();
				mat.dispose();
				this.bursts.splice(i, 1);
			}
		}
	}

	dispose(): void {
		for (const b of this.bursts) {
			b.mesh.removeFromParent();
			(b.mesh.material as THREE.Material).dispose();
		}
		this.bursts.length = 0;
		this.geo.dispose();
		this.root.removeFromParent();
	}
}
