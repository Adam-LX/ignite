import * as THREE from "three";

import type { PowerUpHudState } from "../../modes/IgnitionManager";
import { getPowerUpIconTexture } from "../powerUpHudIcon";
import { powerUpNeedsReticle } from "../powerUpIcons";
import { PowerUpPickupDisplay } from "../powerUpPickupModel";
import {
	POWER_UP_COLORS,
	type PowerUpVisualKind,
	powerUpRingFill,
	resolvePowerUpVisualKind,
	shouldShowPowerUpWorld,
} from "../powerUpVisuals";

function kindColor(kind: PowerUpVisualKind): number {
	return POWER_UP_COLORS[kind].three;
}

/** Wiązki magnesu / plungera + stożki kolców. RL: efekt tylko po aktywacji. */
class PowerUpBeamVfx {
	private readonly core: THREE.Line;
	private readonly coreMat: THREE.LineBasicMaterial;
	private readonly glow: THREE.Mesh;
	private readonly glowMat: THREE.MeshBasicMaterial;
	private readonly funnel: THREE.Mesh;
	private readonly funnelMat: THREE.MeshBasicMaterial;
	private readonly tmpDir = new THREE.Vector3();
	private readonly tmpMid = new THREE.Vector3();
	private readonly up = new THREE.Vector3(0, 1, 0);
	private readonly isMagnet: boolean;

	constructor(scene: THREE.Scene, color: number, isMagnet: boolean) {
		this.isMagnet = isMagnet;
		this.coreMat = new THREE.LineBasicMaterial({
			color,
			transparent: true,
			opacity: 0.85,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		this.core = new THREE.Line(
			new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(),
				new THREE.Vector3(),
			]),
			this.coreMat,
		);
		this.core.frustumCulled = false;
		this.core.renderOrder = 8;

		this.glowMat = new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0.22,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.glow = new THREE.Mesh(
			new THREE.CylinderGeometry(
				isMagnet ? 0.22 : 0.08,
				isMagnet ? 0.05 : 0.12,
				1,
				14,
				1,
				true,
			),
			this.glowMat,
		);
		this.glow.frustumCulled = false;
		this.glow.renderOrder = 7;

		this.funnelMat = new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0.14,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.funnel = new THREE.Mesh(
			new THREE.ConeGeometry(isMagnet ? 1.15 : 0.5, 0.55, 16, 1, true),
			this.funnelMat,
		);
		this.funnel.frustumCulled = false;
		this.funnel.renderOrder = 6;

		scene.add(this.core, this.glow, this.funnel);
		this.hide();
	}

	update(
		visible: boolean,
		from: THREE.Vector3,
		to: THREE.Vector3,
		intensity: number,
	): void {
		if (!visible) {
			this.hide();
			return;
		}

		this.core.visible = true;
		this.glow.visible = true;
		this.funnel.visible = this.isMagnet;

		const pos = this.core.geometry.attributes.position as THREE.BufferAttribute;
		pos.setXYZ(0, from.x, from.y, from.z);
		pos.setXYZ(1, to.x, to.y, to.z);
		pos.needsUpdate = true;
		this.core.geometry.computeBoundingSphere();

		this.tmpDir.subVectors(to, from);
		const len = this.tmpDir.length();
		if (len < 0.05) {
			this.hide();
			return;
		}
		this.tmpMid.addVectors(from, to).multiplyScalar(0.5);
		this.glow.position.copy(this.tmpMid);
		const widthScale = this.isMagnet ? 1.1 + intensity * 0.45 : 1;
		this.glow.scale.set(widthScale, len, widthScale);
		this.glow.quaternion.setFromUnitVectors(this.up, this.tmpDir.normalize());

		if (this.isMagnet) {
			this.funnel.position.copy(from);
			const funnelScale = 0.35 + intensity * 0.55;
			this.funnel.scale.set(funnelScale, funnelScale * 0.9, funnelScale);
			this.funnel.quaternion.copy(this.glow.quaternion);
		}

		const pulse = 0.88 + Math.sin(performance.now() * 0.014) * 0.12;
		const i = Math.min(1, Math.max(0.3, intensity)) * pulse;
		this.coreMat.opacity = 0.5 + i * 0.42;
		this.glowMat.opacity = this.isMagnet ? 0.16 + i * 0.32 : 0.12 + i * 0.24;
		this.funnelMat.opacity = 0.08 + i * 0.18;
	}

	hide(): void {
		this.core.visible = false;
		this.glow.visible = false;
		this.funnel.visible = false;
	}

	dispose(): void {
		this.core.removeFromParent();
		this.glow.removeFromParent();
		this.funnel.removeFromParent();
		this.core.geometry.dispose();
		this.coreMat.dispose();
		this.glow.geometry.dispose();
		this.glowMat.dispose();
		this.funnel.geometry.dispose();
		this.funnelMat.dispose();
	}
}

const SPIKE_LAYOUT: ReadonlyArray<{
	x: number;
	z: number;
	h: number;
	r: number;
	tilt: number;
}> = [
	{ x: -0.3, z: 0.04, h: 0.11, r: 0.028, tilt: 0.12 },
	{ x: -0.15, z: -0.02, h: 0.15, r: 0.032, tilt: 0.08 },
	{ x: 0, z: 0.02, h: 0.19, r: 0.036, tilt: 0.05 },
	{ x: 0.15, z: -0.02, h: 0.15, r: 0.032, tilt: 0.08 },
	{ x: 0.3, z: 0.04, h: 0.11, r: 0.028, tilt: 0.12 },
	{ x: -0.08, z: -0.14, h: 0.09, r: 0.024, tilt: 0.18 },
	{ x: 0.08, z: -0.14, h: 0.09, r: 0.024, tilt: 0.18 },
];

export class PowerUpCarVfx {
	private readonly spikesGroup = new THREE.Group();
	private readonly spikeMeshes: THREE.Mesh[] = [];

	private readonly reticle: THREE.Group;
	private readonly reticleRing: THREE.Mesh;
	private readonly reticleH: THREE.Mesh;
	private readonly reticleV: THREE.Mesh;
	private readonly reticleDot: THREE.Mesh;
	private readonly reticleIcon: THREE.Sprite;
	private reticleIconKind: PowerUpVisualKind | null = null;

	private readonly magnetBeam: PowerUpBeamVfx;
	private readonly plungerBeam: PowerUpBeamVfx;
	private readonly pickupDisplay: PowerUpPickupDisplay;

	private readonly tmpCar = new THREE.Vector3();
	private readonly tmpBall = new THREE.Vector3();

	constructor(parent: THREE.Object3D, scene: THREE.Scene) {
		this.spikesGroup.name = "powerUpSpikes";
		parent.add(this.spikesGroup);

		const spikeMat = new THREE.MeshStandardMaterial({
			color: 0xff8a9a,
			emissive: 0xcc2244,
			emissiveIntensity: 0.55,
			metalness: 0.82,
			roughness: 0.22,
		});
		const roofY = 0.36;
		for (const layout of SPIKE_LAYOUT) {
			const cone = new THREE.Mesh(
				new THREE.ConeGeometry(layout.r, layout.h, 8),
				spikeMat.clone(),
			);
			cone.position.set(layout.x, roofY + layout.h * 0.5, layout.z);
			cone.rotation.x = layout.tilt;
			cone.castShadow = true;
			this.spikeMeshes.push(cone);
			this.spikesGroup.add(cone);
		}
		this.spikesGroup.visible = false;

		this.reticle = new THREE.Group();
		this.reticle.name = "powerUpReticle";
		const retMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		this.reticleRing = new THREE.Mesh(
			new THREE.RingGeometry(0.62, 0.82, 36),
			retMat,
		);
		this.reticleRing.rotation.x = -Math.PI / 2;
		this.reticleH = new THREE.Mesh(
			new THREE.PlaneGeometry(1.55, 0.07),
			retMat.clone(),
		);
		this.reticleH.rotation.x = -Math.PI / 2;
		this.reticleV = new THREE.Mesh(
			new THREE.PlaneGeometry(0.07, 1.55),
			retMat.clone(),
		);
		this.reticleV.rotation.x = -Math.PI / 2;
		this.reticleDot = new THREE.Mesh(
			new THREE.CircleGeometry(0.09, 16),
			retMat.clone(),
		);
		this.reticleDot.rotation.x = -Math.PI / 2;
		const iconMat = new THREE.SpriteMaterial({
			transparent: true,
			depthWrite: false,
			opacity: 0.92,
		});
		this.reticleIcon = new THREE.Sprite(iconMat);
		this.reticleIcon.scale.set(0.72, 0.72, 1);
		this.reticleIcon.position.y = 0.14;
		this.reticleIcon.renderOrder = 9;
		this.reticle.add(
			this.reticleRing,
			this.reticleH,
			this.reticleV,
			this.reticleDot,
			this.reticleIcon,
		);
		scene.add(this.reticle);

		this.magnetBeam = new PowerUpBeamVfx(
			scene,
			POWER_UP_COLORS.magnet.three,
			true,
		);
		this.plungerBeam = new PowerUpBeamVfx(
			scene,
			POWER_UP_COLORS.plunger.three,
			false,
		);
		this.pickupDisplay = new PowerUpPickupDisplay(parent);

		this.hideAll();
	}

	update(
		state: PowerUpHudState | null,
		carWorldPos: THREE.Vector3,
		ballPos: THREE.Vector3 | null,
		_dt: number,
	): void {
		if (!state?.enabled) {
			this.hideAll();
			return;
		}

		const held = state.held;
		this.pickupDisplay.setHeld(held);
		this.pickupDisplay.tick(_dt);

		const show = shouldShowPowerUpWorld(state);
		if (!show) {
			this.hideActiveVfx();
			return;
		}

		const active = state.activeKind;
		const activeProgress = state.activeProgress;
		const pulse = 0.85 + Math.sin(performance.now() * 0.008) * 0.15;

		const showSpikes = held === "spikes" || active === "spikes";
		this.spikesGroup.visible = showSpikes;
		if (showSpikes) {
			const activeSpikes = active === "spikes";
			for (const spike of this.spikeMeshes) {
				const mat = spike.material as THREE.MeshStandardMaterial;
				mat.emissiveIntensity = activeSpikes ? 1.1 * pulse : 0.5;
				spike.scale.setScalar(activeSpikes ? 1 + pulse * 0.04 : 1);
			}
		}

		const reticleKind = active;
		const showReticle =
			ballPos !== null &&
			reticleKind !== null &&
			powerUpNeedsReticle(held, active, activeProgress);
		if (showReticle && ballPos && reticleKind) {
			this.reticle.visible = true;
			this.reticle.position.copy(ballPos);
			this.reticle.position.y = Math.max(0.38, ballPos.y + 0.04);
			const visualKind = reticleKind as PowerUpVisualKind;
			const col = new THREE.Color(kindColor(visualKind));
			if (this.reticleIconKind !== visualKind) {
				const mat = this.reticleIcon.material as THREE.SpriteMaterial;
				mat.map = getPowerUpIconTexture(visualKind);
				mat.needsUpdate = true;
				this.reticleIconKind = visualKind;
			}
			this.reticleIcon.visible = true;
			(this.reticleIcon.material as THREE.SpriteMaterial).color.copy(col);
			for (const m of [
				this.reticleRing,
				this.reticleH,
				this.reticleV,
				this.reticleDot,
			] as THREE.Mesh[]) {
				(m.material as THREE.MeshBasicMaterial).color.copy(col);
				(m.material as THREE.MeshBasicMaterial).opacity = 0.5 + pulse * 0.35;
			}
			const s = 1 + (1 - activeProgress) * 0.12;
			this.reticleRing.scale.setScalar(s);
		} else {
			this.reticle.visible = false;
			this.reticleIcon.visible = false;
		}

		const hasMagnet = active === "magnet" && activeProgress > 0;
		const hasPlunger = active === "plunger" && activeProgress > 0;

		if (ballPos && (hasMagnet || hasPlunger)) {
			this.beamEndpoints(carWorldPos, ballPos, hasMagnet, hasPlunger);
		}

		this.magnetBeam.update(
			hasMagnet && ballPos !== null,
			this.tmpCar,
			this.tmpBall,
			activeProgress,
		);
		this.plungerBeam.update(
			hasPlunger && ballPos !== null,
			this.tmpCar,
			this.tmpBall,
			activeProgress,
		);

		void resolvePowerUpVisualKind(state);
		void powerUpRingFill(state);
	}

	private beamEndpoints(
		carPos: THREE.Vector3,
		ballPos: THREE.Vector3,
		magnet: boolean,
		plunger: boolean,
	): void {
		this.tmpCar.copy(carPos);
		this.tmpCar.y += 0.42;
		if (plunger && !magnet) {
			this.tmpCar.z -= 0.55;
		} else {
			this.tmpCar.z += 0.35;
		}
		this.tmpBall.copy(ballPos);
	}

	private hideActiveVfx(): void {
		this.spikesGroup.visible = false;
		this.reticle.visible = false;
		this.magnetBeam.hide();
		this.plungerBeam.hide();
	}

	private hideAll(): void {
		this.hideActiveVfx();
		this.pickupDisplay.setHeld(null);
	}

	dispose(): void {
		this.spikesGroup.removeFromParent();
		this.reticle.removeFromParent();
		this.pickupDisplay.dispose();
		this.magnetBeam.dispose();
		this.plungerBeam.dispose();
		for (const spike of this.spikeMeshes) {
			spike.geometry.dispose();
			(spike.material as THREE.Material).dispose();
		}
		this.reticleRing.geometry.dispose();
		this.reticleH.geometry.dispose();
		this.reticleV.geometry.dispose();
		this.reticleDot.geometry.dispose();
		(this.reticleRing.material as THREE.Material).dispose();
		(this.reticleH.material as THREE.Material).dispose();
		(this.reticleV.material as THREE.Material).dispose();
		(this.reticleDot.material as THREE.Material).dispose();
		(this.reticleIcon.material as THREE.Material).dispose();
	}
}
