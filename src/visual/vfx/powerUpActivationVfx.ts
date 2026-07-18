import * as THREE from "three";

import type { PowerUpKind } from "../../modes/IgnitionManager";
import { POWER_UP_COLORS } from "../powerUpVisuals";

const POOL = 8;
const DURATION = 0.38;

type BurstSlot = {
	active: boolean;
	life: number;
	kind: PowerUpKind;
	root: THREE.Group;
	ring: THREE.Mesh;
	core: THREE.Mesh;
	streak: THREE.Mesh;
};

const KIND_SCALE: Record<PowerUpKind, number> = {
	magnet: 1.15,
	plunger: 1.05,
	haymaker: 1.45,
	spikes: 1.2,
};

/** Błysk / shockwave przy aktywacji power-upu (Ignition M3). */
export class PowerUpActivationVfx {
	private readonly slots: BurstSlot[] = [];
	private readonly forward = new THREE.Vector3();

	constructor(scene: THREE.Scene) {
		for (let i = 0; i < POOL; i++) {
			const root = new THREE.Group();
			root.name = "powerUpActivationBurst";
			root.visible = false;
			scene.add(root);

			const ringMat = new THREE.MeshBasicMaterial({
				color: 0xffffff,
				transparent: true,
				opacity: 0.88,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
			});
			const ring = new THREE.Mesh(
				new THREE.RingGeometry(0.35, 0.72, 40),
				ringMat,
			);
			ring.rotation.x = -Math.PI / 2;

			const coreMat = new THREE.MeshBasicMaterial({
				color: 0xffffff,
				transparent: true,
				opacity: 0.72,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
			});
			const core = new THREE.Mesh(
				new THREE.SphereGeometry(0.42, 14, 12),
				coreMat,
			);

			const streakMat = coreMat.clone();
			const streak = new THREE.Mesh(
				new THREE.CylinderGeometry(0.08, 0.22, 1.2, 10, 1, true),
				streakMat,
			);
			streak.visible = false;

			root.add(ring, core, streak);
			this.slots.push({
				active: false,
				life: 0,
				kind: "magnet",
				root,
				ring,
				core,
				streak,
			});
		}
	}

	trigger(
		kind: PowerUpKind,
		position: THREE.Vector3,
		forward?: THREE.Vector3,
	): void {
		const slot = this.slots.find((s) => !s.active);
		if (!slot) return;

		const color = POWER_UP_COLORS[kind].three;
		slot.active = true;
		slot.life = DURATION;
		slot.kind = kind;
		slot.root.position.copy(position);
		slot.root.visible = true;

		const ringMat = slot.ring.material as THREE.MeshBasicMaterial;
		const coreMat = slot.core.material as THREE.MeshBasicMaterial;
		ringMat.color.setHex(color);
		coreMat.color.setHex(color);
		ringMat.opacity = 0.9;
		coreMat.opacity = 0.75;

		const scale = KIND_SCALE[kind];
		slot.ring.scale.setScalar(0.2 * scale);
		slot.core.scale.setScalar(0.35 * scale);

		const showStreak = kind === "haymaker" || kind === "plunger";
		slot.streak.visible = showStreak;
		if (showStreak && forward) {
			this.forward.copy(forward);
			this.forward.y = 0;
			if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, 1);
			else this.forward.normalize();
			slot.streak.position.set(0, 0.12, 0);
			slot.streak.quaternion.setFromUnitVectors(
				new THREE.Vector3(0, 1, 0),
				this.forward,
			);
			(slot.streak.material as THREE.MeshBasicMaterial).color.setHex(color);
			slot.streak.scale.set(
				kind === "haymaker" ? 1.35 : 1,
				kind === "haymaker" ? 2.4 : 1.6,
				kind === "haymaker" ? 1.35 : 1,
			);
		}
	}

	update(dt: number): void {
		for (const slot of this.slots) {
			if (!slot.active) continue;
			slot.life -= dt;
			if (slot.life <= 0) {
				slot.active = false;
				slot.root.visible = false;
				continue;
			}

			const t = 1 - slot.life / DURATION;
			const ease = 1 - (1 - t) ** 2.2;
			const scale = KIND_SCALE[slot.kind];
			const ringScale = (0.2 + ease * 9.5) * scale;
			slot.ring.scale.setScalar(ringScale);
			(slot.ring.material as THREE.MeshBasicMaterial).opacity =
				0.9 * (1 - t) ** 1.25;

			const coreScale = (0.35 + ease * 1.8) * scale;
			slot.core.scale.setScalar(coreScale);
			(slot.core.material as THREE.MeshBasicMaterial).opacity =
				0.75 * (1 - t) ** 1.6;

			if (slot.streak.visible) {
				(slot.streak.material as THREE.MeshBasicMaterial).opacity =
					0.55 * (1 - t) ** 1.4;
			}
		}
	}

	dispose(): void {
		for (const slot of this.slots) {
			slot.root.removeFromParent();
			slot.ring.geometry.dispose();
			slot.core.geometry.dispose();
			slot.streak.geometry.dispose();
			(slot.ring.material as THREE.Material).dispose();
			(slot.core.material as THREE.Material).dispose();
			(slot.streak.material as THREE.Material).dispose();
		}
	}
}
