import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y } from "../arenaConstants";

const POOL = 8;
const DUST = 22;

type Burst = {
	root: THREE.Group;
	ring: THREE.Mesh;
	dust: THREE.Points;
	positions: Float32Array;
	life: number;
	maxLife: number;
	intensity: number;
};

/** Puff pyłu gdy piłka mocno uderza w murawę. */
export class BallTurfDustVfx {
	private readonly pool: Burst[] = [];
	private head = 0;

	constructor(scene: THREE.Scene) {
		for (let i = 0; i < POOL; i++) {
			const root = new THREE.Group();
			root.name = `ballTurfDust_${i}`;
			root.visible = false;
			scene.add(root);

			const ring = new THREE.Mesh(
				new THREE.RingGeometry(0.15, 0.55, 32),
				new THREE.MeshBasicMaterial({
					color: 0xc8e8a8,
					transparent: true,
					opacity: 0,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
					side: THREE.DoubleSide,
				}),
			);
			ring.rotation.x = -Math.PI / 2;
			root.add(ring);

			const positions = new Float32Array(DUST * 3);
			const geo = new THREE.BufferGeometry();
			geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
			const dust = new THREE.Points(
				geo,
				new THREE.PointsMaterial({
					color: 0xd4c89a,
					size: 0.2,
					transparent: true,
					opacity: 0,
					depthWrite: false,
					sizeAttenuation: true,
				}),
			);
			dust.frustumCulled = false;
			root.add(dust);
			this.pool.push({
				root,
				ring,
				dust,
				positions,
				life: 0,
				maxLife: 0.5,
				intensity: 0,
			});
		}
	}

	trigger(worldPos: THREE.Vector3, impact: number): void {
		if (impact < 3.5) return;
		if (worldPos.y > PLAYFIELD_SURFACE_Y + 1.2) return;
		const slot = this.pool[this.head]!;
		this.head = (this.head + 1) % POOL;
		slot.intensity = THREE.MathUtils.clamp(impact / 22, 0.2, 1);
		slot.root.position.set(worldPos.x, PLAYFIELD_SURFACE_Y + 0.05, worldPos.z);
		slot.root.visible = true;
		slot.maxLife = 0.38 + slot.intensity * 0.28;
		slot.life = slot.maxLife;

		for (let i = 0; i < DUST; i++) {
			const i3 = i * 3;
			const a = Math.random() * Math.PI * 2;
			const r = Math.random() * (0.3 + slot.intensity * 0.9);
			slot.positions[i3] = Math.cos(a) * r;
			slot.positions[i3 + 1] = 0.02 + Math.random() * 0.08;
			slot.positions[i3 + 2] = Math.sin(a) * r;
		}
		(
			slot.dust.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
		slot.ring.scale.setScalar(0.35);
		(slot.ring.material as THREE.MeshBasicMaterial).opacity =
			0.4 + slot.intensity * 0.4;
		(slot.dust.material as THREE.PointsMaterial).opacity =
			0.55 + slot.intensity * 0.35;
	}

	update(dt: number): void {
		for (const slot of this.pool) {
			if (slot.life <= 0) continue;
			slot.life -= dt;
			const t = 1 - slot.life / slot.maxLife;
			slot.ring.scale.setScalar(0.35 + t * (2.8 + slot.intensity * 2));
			(slot.ring.material as THREE.MeshBasicMaterial).opacity =
				(0.45 + slot.intensity * 0.35) * (1 - t) ** 1.3;
			for (let i = 0; i < DUST; i++) {
				const i3 = i * 3;
				slot.positions[i3 + 1]! += dt * (1.2 + slot.intensity * 2);
				slot.positions[i3]! *= 1 + dt * 1.5;
				slot.positions[i3 + 2]! *= 1 + dt * 1.5;
			}
			(
				slot.dust.geometry.getAttribute("position") as THREE.BufferAttribute
			).needsUpdate = true;
			(slot.dust.material as THREE.PointsMaterial).opacity =
				(0.6 + slot.intensity * 0.3) * (1 - t) ** 1.1;
			if (slot.life <= 0) slot.root.visible = false;
		}
	}

	dispose(): void {
		for (const slot of this.pool) {
			slot.ring.geometry.dispose();
			(slot.ring.material as THREE.Material).dispose();
			slot.dust.geometry.dispose();
			(slot.dust.material as THREE.Material).dispose();
			slot.root.removeFromParent();
		}
	}
}
