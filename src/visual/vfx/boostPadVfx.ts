import * as THREE from "three";
import { resolveArenaNeonHex } from "../../arena/arenaNeonAccent";
import type { BoostPadPickupEvent } from "../../arena/BoostPadManager";
import { resolveBoostPadLayout } from "../../arena/boostPadLayout";

type PadMesh = {
	root: THREE.Group;
	ring: THREE.Mesh;
	core: THREE.Mesh;
	glow: THREE.PointLight;
	big: boolean;
	pulse: number;
};

/** Wizualizacja boost padów — emissive ring + respawn animacja. */
export class BoostPadVfx {
	private readonly root = new THREE.Group();
	private readonly pads: PadMesh[] = [];
	private readonly pickupBursts: {
		mesh: THREE.Mesh;
		life: number;
		maxLife: number;
	}[] = [];

	constructor(scene: THREE.Scene) {
		this.root.name = "boostPads";
		scene.add(this.root);

		const ringGeo = new THREE.RingGeometry(0.55, 1, 32);
		const coreGeo = new THREE.CircleGeometry(0.42, 24);

		for (const spec of resolveBoostPadLayout()) {
			const group = new THREE.Group();
			group.position.set(spec.x, 0.06, spec.z);
			group.rotation.x = -Math.PI / 2;

			const ringMat = new THREE.MeshBasicMaterial({
				color: spec.big ? 0xffee88 : 0xffcc44,
				transparent: true,
				opacity: 0.85,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
			});
			const coreMat = new THREE.MeshBasicMaterial({
				color: spec.big ? 0xffffcc : 0xffdd66,
				transparent: true,
				opacity: 0.55,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
			});

			const ring = new THREE.Mesh(ringGeo, ringMat);
			const core = new THREE.Mesh(coreGeo, coreMat);
			const scale = spec.big ? 2.1 : 1.35;
			ring.scale.setScalar(scale);
			core.scale.setScalar(scale * 0.72);
			group.add(ring, core);

			const glow = new THREE.PointLight(
				spec.big ? 0xffee99 : 0xffcc55,
				spec.big ? 0.9 : 0.45,
				spec.big ? 14 : 8,
			);
			glow.position.set(0, 0.4, 0);
			group.add(glow);

			this.root.add(group);
			this.pads.push({
				root: group,
				ring,
				core,
				glow,
				big: spec.big,
				pulse: Math.random() * Math.PI * 2,
			});
		}

		const burstGeo = new THREE.RingGeometry(0.2, 1, 24);
		for (let i = 0; i < 6; i++) {
			const mesh = new THREE.Mesh(
				burstGeo,
				new THREE.MeshBasicMaterial({
					color: 0xffffff,
					transparent: true,
					opacity: 0,
					depthWrite: false,
					blending: THREE.AdditiveBlending,
					side: THREE.DoubleSide,
				}),
			);
			mesh.rotation.x = -Math.PI / 2;
			mesh.visible = false;
			this.root.add(mesh);
			this.pickupBursts.push({ mesh, life: 0, maxLife: 0 });
		}
	}

	/** Tint padów kolorem neonu aktywnej mapy. */
	setArenaAccent(accent?: string): void {
		const accentColor = new THREE.Color(resolveArenaNeonHex(accent));
		const smallRing = accentColor.clone().lerp(new THREE.Color(0xffcc44), 0.45);
		const bigRing = accentColor.clone().lerp(new THREE.Color(0xffee88), 0.55);
		for (const pad of this.pads) {
			const ringMat = pad.ring.material as THREE.MeshBasicMaterial;
			const coreMat = pad.core.material as THREE.MeshBasicMaterial;
			const ring = pad.big ? bigRing : smallRing;
			ringMat.color.copy(ring);
			coreMat.color.copy(ring.clone().lerp(new THREE.Color(0xffffff), 0.35));
			pad.glow.color.copy(ring);
			pad.glow.intensity = pad.big ? 1.05 : 0.55;
		}
	}

	triggerPickup(event: BoostPadPickupEvent): void {
		const slot = this.pickupBursts.find((b) => b.life <= 0);
		if (!slot) return;
		slot.life = 0.62;
		slot.maxLife = 0.62;
		slot.mesh.position.copy(event.position);
		slot.mesh.position.y = 0.1;
		slot.mesh.scale.setScalar(event.big ? 3.4 : 2.1);
		slot.mesh.visible = true;
		const burst = new THREE.Color(resolveArenaNeonHex());
		burst.lerp(new THREE.Color(0xffffff), event.big ? 0.55 : 0.38);
		(slot.mesh.material as THREE.MeshBasicMaterial).color.copy(burst);
	}

	update(
		dt: number,
		states: ReadonlyArray<{
			index: number;
			active: boolean;
			respawnRatio: number;
		}>,
	): void {
		for (const state of states) {
			const pad = this.pads[state.index];
			if (!pad) continue;
			pad.pulse += dt * (pad.big ? 2.4 : 3.2);
			const breathe = 0.88 + Math.sin(pad.pulse) * 0.12;
			if (state.active) {
				const s = (pad.big ? 2.1 : 1.35) * breathe;
				pad.ring.scale.setScalar(s);
				pad.core.scale.setScalar(s * 0.72);
				(pad.ring.material as THREE.MeshBasicMaterial).opacity = pad.big
					? 0.92
					: 0.78;
				(pad.core.material as THREE.MeshBasicMaterial).opacity = 0.55;
				pad.glow.intensity = pad.big ? 0.95 : 0.5;
				pad.root.visible = true;
			} else {
				const t = state.respawnRatio;
				const s = (pad.big ? 2.1 : 1.35) * (0.15 + t * 0.85);
				pad.ring.scale.setScalar(s);
				pad.core.scale.setScalar(s * 0.72);
				(pad.ring.material as THREE.MeshBasicMaterial).opacity =
					0.12 + t * 0.35;
				(pad.core.material as THREE.MeshBasicMaterial).opacity = t * 0.25;
				pad.glow.intensity = t * (pad.big ? 0.4 : 0.2);
				pad.root.visible = t > 0.02;
			}
		}

		for (const burst of this.pickupBursts) {
			if (burst.life <= 0) {
				burst.mesh.visible = false;
				continue;
			}
			burst.life -= dt;
			const u = 1 - burst.life / burst.maxLife;
			burst.mesh.scale.multiplyScalar(1 + dt * 2.8);
			(burst.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.85;
		}
	}

	dispose(): void {
		const ringGeo = this.pads[0]?.ring.geometry;
		const coreGeo = this.pads[0]?.core.geometry;
		const burstGeo = this.pickupBursts[0]?.mesh.geometry;
		for (const pad of this.pads) {
			(pad.ring.material as THREE.Material).dispose();
			(pad.core.material as THREE.Material).dispose();
			pad.glow.dispose();
		}
		for (const burst of this.pickupBursts) {
			(burst.mesh.material as THREE.Material).dispose();
		}
		ringGeo?.dispose();
		coreGeo?.dispose();
		burstGeo?.dispose();
		this.root.removeFromParent();
	}
}
