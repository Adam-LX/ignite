import * as THREE from "three";

import type GameObject from "../../GameObject";
import type { ScoringTeam } from "../../game/modes";
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

	constructor(
		_ballMesh: THREE.Object3D,
		scene: THREE.Scene,
		_ballRadius: number,
		preserveMeshyMaterials = false,
	) {
		this.preserveMeshyMaterials = preserveMeshyMaterials;
		this.plasmaTrail = new PlasmaBallTrail(scene);
		this.machCone = new BallMachConeVfx(scene);
		this.motionStreak = new BallMotionStreak(scene);
	}

	setTeamTint(team: ScoringTeam | null): void {
		this.teamEmissive = ballPaletteForTeam(team).emissive;
		this.plasmaTrail.setTeamTint(team);
		this.motionStreak.setTeamColor(ballPaletteForTeam(team).emissive);
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
	}

	private updateSpeedEmissive(root: THREE.Object3D, speedMps: number): void {
		if (!this.preserveMeshyMaterials) return;
		if (this.emissiveMeshes.length === 0) {
			root.traverse((child) => {
				if (!(child instanceof THREE.Mesh)) return;
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
					mat.emissiveIntensity = 0.65 + glow;
				}
			}
		}
	}

	private applyOpaqueBallMaterial(root: THREE.Object3D): void {
		root.visible = true;
		if (this.preserveMeshyMaterials) {
			root.traverse((child) => {
				if (child instanceof THREE.Light) {
					child.visible = false;
					child.intensity = 0;
					return;
				}
				child.visible = true;
				if (!(child instanceof THREE.Mesh)) return;
				child.castShadow = true;
				child.receiveShadow = true;
				child.renderOrder = 0;
				const mats = Array.isArray(child.material)
					? child.material
					: [child.material];
				for (const mat of mats) {
					if (
						mat instanceof THREE.MeshStandardMaterial ||
						mat instanceof THREE.MeshPhysicalMaterial
					) {
						if (mat.emissiveIntensity < 0.55) {
							mat.emissive.setHex(this.teamEmissive);
							mat.emissiveIntensity = 0.65;
						}
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
			child.userData.ballOpaque = true;
		});
		this.ballMaterialApplied = true;
	}

	dispose(): void {
		this.plasmaTrail.dispose();
		this.machCone.dispose();
		this.motionStreak.dispose();
	}
}
