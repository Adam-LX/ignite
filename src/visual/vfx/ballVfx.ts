import * as THREE from "three";

import type GameObject from "../../GameObject";
import type { ScoringTeam } from "../../game/modes";
import { isPathTraceLookEnabled } from "../../util/presentationPrefs";
import { PLAYFIELD_SURFACE_Y } from "../arenaConstants";
import { ballPaletteForTeam } from "../ballTeamVisual";
import { createBallMaterial, triggerBallHitFlash } from "../materials";
import { PlasmaBallTrail } from "../Trail";
import { BallMachConeVfx } from "./ballMachConeVfx";
import { BallMotionStreak } from "./ballMotionStreak";

/**
 * Efekty piłki — materiał PBR + przestrzenny ogon plazmowy (THREE.Points).
 */
export class BallVfx {
	private readonly plasmaTrail: PlasmaBallTrail;
	private readonly ballMaterial = createBallMaterial();
	private ballMaterialApplied = false;
	private readonly preserveMeshyMaterials: boolean;
	private readonly emissiveMeshes: THREE.Mesh[] = [];
	private readonly machCone: BallMachConeVfx;
	private readonly motionStreak: BallMotionStreak;
	private teamEmissive = ballPaletteForTeam(null).emissive;
	private readonly scratchVel = new THREE.Vector3();
	private readonly scratchPos = new THREE.Vector3();
	private readonly warmupVel = new THREE.Vector3(0, 0, 24);
	/** Miękka aura — czytelność niezależna od bloom/oświetlenia. */
	private readabilityAura: THREE.Mesh | null = null;
	private readonly ballRadius: number;
	/** Fake GI: krótki fill na murawę pod piłką (widoczny przy path-trace look). */
	private readonly groundFill: THREE.PointLight;

	constructor(
		_ballMesh: THREE.Object3D,
		scene: THREE.Scene,
		ballRadius: number,
		preserveMeshyMaterials = false,
	) {
		this.preserveMeshyMaterials = preserveMeshyMaterials;
		this.ballRadius = ballRadius;
		this.plasmaTrail = new PlasmaBallTrail(scene);
		this.machCone = new BallMachConeVfx(scene);
		this.motionStreak = new BallMotionStreak(scene);
		this.groundFill = new THREE.PointLight(0xffe8c8, 0, 7.5, 2.05);
		this.groundFill.name = "ballGroundFill";
		this.groundFill.castShadow = false;
		scene.add(this.groundFill);
	}

	setTeamTint(team: ScoringTeam | null): void {
		this.teamEmissive = ballPaletteForTeam(team).emissive;
		this.plasmaTrail.setTeamTint(team);
		this.motionStreak.setTeamColor(ballPaletteForTeam(team).emissive);
		if (this.readabilityAura) {
			(this.readabilityAura.material as THREE.MeshBasicMaterial).color.setHex(
				this.teamEmissive,
			);
		}
	}

	triggerPowerShotBoost(impact: number): void {
		this.motionStreak.triggerPowerShotBoost(impact);
		triggerBallHitFlash(THREE.MathUtils.clamp((impact - 14) / 16, 0.55, 1.35));
	}

	warmup(): void {
		this.plasmaTrail.warmup();
	}

	/** Materiał piłki + trail — przed pierwszym uderzeniem. */
	primeGpuDraw(ball: GameObject): THREE.Object3D[] {
		if (!this.ballMaterialApplied) {
			this.applyOpaqueBallMaterial(ball.threeJSGroup);
		}
		const pos = ball.getPosition();
		this.plasmaTrail.primeGpuDraw(pos, this.warmupVel);
		return [ball.threeJSGroup, ...this.plasmaTrail.getDrawables()];
	}

	clearGpuWarmup(ball: GameObject): void {
		this.plasmaTrail.warmup();
		this.scratchVel.set(0, 0, 0);
		this.plasmaTrail.update(ball.getPosition(), this.scratchVel, 0);
	}

	resetTrail(): void {
		this.plasmaTrail.warmup();
	}

	update(ball: GameObject, dt: number): void {
		const vel = this.scratchVel.copy(ball.getVelocity());
		const pos = this.scratchPos.copy(ball.getPosition());

		if (!this.ballMaterialApplied) {
			this.applyOpaqueBallMaterial(ball.threeJSGroup);
		}

		this.plasmaTrail.update(pos, vel, dt);
		const speed = vel.length();
		this.updateSpeedEmissive(ball.threeJSGroup, speed);
		this.machCone.update(pos, speed, dt);
		this.motionStreak.update(pos, vel, dt);

		const pt = isPathTraceLookEnabled();
		this.groundFill.position.set(
			pos.x,
			Math.max(pos.y, PLAYFIELD_SURFACE_Y + 0.35),
			pos.z,
		);
		this.groundFill.color.setHex(this.teamEmissive);
		const nearGround = THREE.MathUtils.clamp(
			1 - Math.max(0, pos.y - PLAYFIELD_SURFACE_Y) / 4.5,
			0,
			1,
		);
		this.groundFill.intensity = pt
			? (1.35 + THREE.MathUtils.clamp(speed / 22, 0, 1.1)) * (0.45 + nearGround * 0.7)
			: 0.22 * nearGround;
	}

	private ensureReadabilityAura(root: THREE.Object3D): void {
		if (this.readabilityAura) return;
		const mat = new THREE.MeshBasicMaterial({
			color: this.teamEmissive,
			transparent: true,
			opacity: 0.2,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			toneMapped: false,
			fog: false,
			side: THREE.BackSide,
		});
		const geo = new THREE.SphereGeometry(1, 24, 20);
		const aura = new THREE.Mesh(geo, mat);
		aura.name = "ballReadabilityAura";
		/** fitScale na root — lokalny radius = worldRadius / scale. */
		const sx = Math.max(Math.abs(root.scale.x), 1e-6);
		aura.scale.setScalar((this.ballRadius / sx) * 1.14);
		aura.renderOrder = 2;
		aura.frustumCulled = false;
		root.add(aura);
		this.readabilityAura = aura;
	}

	private updateSpeedEmissive(root: THREE.Object3D, speedMps: number): void {
		this.ensureReadabilityAura(root);
		if (this.readabilityAura) {
			const pulse = 0.16 + THREE.MathUtils.clamp(speedMps / 28, 0, 0.18);
			(this.readabilityAura.material as THREE.MeshBasicMaterial).opacity =
				pulse;
			(this.readabilityAura.material as THREE.MeshBasicMaterial).color.setHex(
				this.teamEmissive,
			);
		}

		if (!this.preserveMeshyMaterials) return;
		if (this.emissiveMeshes.length === 0) {
			root.traverse((child) => {
				if (!(child instanceof THREE.Mesh)) return;
				if (child === this.readabilityAura) return;
				const mats = Array.isArray(child.material)
					? child.material
					: [child.material];
				for (const mat of mats) {
					if (
						mat instanceof THREE.MeshStandardMaterial ||
						mat instanceof THREE.MeshPhysicalMaterial
					) {
						this.emissiveMeshes.push(child);
						break;
					}
				}
			});
		}
		const glow = THREE.MathUtils.clamp((speedMps - 4) / 14, 0, 2.45);
		for (const mesh of this.emissiveMeshes) {
			const mats = Array.isArray(mesh.material)
				? mesh.material
				: [mesh.material];
			for (const mat of mats) {
				if (
					mat instanceof THREE.MeshStandardMaterial ||
					mat instanceof THREE.MeshPhysicalMaterial
				) {
					mat.emissive.setHex(this.teamEmissive);
					mat.emissiveIntensity = 1.55 + glow;
					mat.toneMapped = false;
					mat.fog = false;
				}
			}
		}
	}

	private applyOpaqueBallMaterial(root: THREE.Object3D): void {
		root.visible = true;
		this.ensureReadabilityAura(root);
		if (this.preserveMeshyMaterials) {
			root.traverse((child) => {
				if (child instanceof THREE.Light) {
					child.visible = false;
					child.intensity = 0;
					return;
				}
				child.visible = true;
				if (!(child instanceof THREE.Mesh)) return;
				if (child === this.readabilityAura) return;
				child.castShadow = true;
				child.receiveShadow = true;
				child.renderOrder = 0;
				child.frustumCulled = false;
				const mats = Array.isArray(child.material)
					? child.material
					: [child.material];
				for (const mat of mats) {
					if (
						mat instanceof THREE.MeshStandardMaterial ||
						mat instanceof THREE.MeshPhysicalMaterial
					) {
						mat.emissive.setHex(this.teamEmissive);
						mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 1.65);
						mat.metalness = Math.min(mat.metalness, 0.28);
						mat.toneMapped = false;
						mat.fog = false;
					}
				}
			});
			this.ballMaterialApplied = true;
			return;
		}
		root.traverse((child) => {
			if (child instanceof THREE.Light) {
				child.visible = false;
				child.intensity = 0;
				return;
			}
			child.visible = true;
			if (!(child instanceof THREE.Mesh)) return;
			if (child === this.readabilityAura) return;
			if (child.userData.ballOpaque) return;

			const prev = child.material;
			if (prev !== this.ballMaterial) {
				if (Array.isArray(prev)) {
					for (const m of prev) {
						if (m !== this.ballMaterial) m.dispose();
					}
				} else if (
					prev instanceof THREE.Material &&
					prev !== this.ballMaterial
				) {
					prev.dispose();
				}
			}

			child.material = this.ballMaterial;
			child.castShadow = true;
			child.receiveShadow = true;
			child.renderOrder = 0;
			child.frustumCulled = false;
			child.userData.ballOpaque = true;
		});
		this.ballMaterialApplied = true;
	}

	dispose(): void {
		this.plasmaTrail.dispose();
		this.machCone.dispose();
		this.motionStreak.dispose();
		this.groundFill.removeFromParent();
		this.groundFill.dispose();
		if (this.readabilityAura) {
			this.readabilityAura.geometry.dispose();
			(this.readabilityAura.material as THREE.Material).dispose();
			this.readabilityAura.removeFromParent();
			this.readabilityAura = null;
		}
	}
}
