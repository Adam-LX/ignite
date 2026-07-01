import type * as THREE from "three";

import { goalFrameMaterial, ledBannerMaterial, RL } from "./materials";

const DEFAULT_BANNER = 0x00ffcc;
const PULSE_DURATION = 5.5;

/**
 * Reaktywne bandy LED — puls emisyjny po golu.
 */
export class StadiumLeds {
	readonly bannerMat: THREE.MeshStandardMaterial;
	readonly goalBlueFrameMat: THREE.MeshStandardMaterial;
	readonly goalOrangeFrameMat: THREE.MeshStandardMaterial;
	private readonly materials: THREE.MeshStandardMaterial[] = [];
	private pulseTeam: "blue" | "orange" | null = null;
	private pulseTime = 0;
	private surgeColor: THREE.Color | null = null;
	private surgeMix = 0;
	private surgeWave = 0;

	constructor() {
		this.bannerMat = ledBannerMaterial(DEFAULT_BANNER);
		this.goalBlueFrameMat = goalFrameMaterial(RL.goalBlue);
		this.goalOrangeFrameMat = goalFrameMaterial(RL.goalOrange);
		this.materials.push(
			this.bannerMat,
			this.goalBlueFrameMat,
			this.goalOrangeFrameMat,
		);
	}

	register(mat: THREE.MeshStandardMaterial): void {
		this.materials.push(mat);
	}

	onGoal(scoringTeam: "blue" | "orange"): void {
		this.pulseTeam = scoringTeam;
		this.pulseTime = PULSE_DURATION;
		const color = scoringTeam === "blue" ? RL.goalBlue : RL.goalOrange;
		for (const mat of this.materials) {
			mat.emissive.setHex(color);
		}
	}

	beginSurge(color: THREE.Color, strength: number): void {
		this.surgeColor = color.clone();
		this.surgeMix = strength;
	}

	endSurge(): void {
		this.surgeColor = null;
		this.surgeMix = 0;
		this.surgeWave = 0;
	}

	updateSurge(
		_surge: { kind: string; elapsed: number },
		envelope: { mix: number; wave: number },
		_timeSec: number,
	): void {
		this.surgeMix = Math.max(0, envelope.mix);
		this.surgeWave = envelope.wave;
	}

	update(dt: number, timeSec: number): void {
		const surgeActive = this.surgeColor && this.surgeMix > 0.01;
		if (surgeActive && this.surgeColor) {
			const wave = 4.2 + Math.sin(timeSec * 16 + this.surgeWave * 2.8) * 2.8;
			const intensity = wave * (0.55 + this.surgeMix * 0.85);
			for (const mat of this.materials) {
				mat.emissive.copy(this.surgeColor);
				mat.emissiveIntensity = intensity;
			}
		}

		if (!this.pulseTeam || this.pulseTime <= 0) {
			if (!surgeActive) {
				this.bannerMat.emissive.setHex(DEFAULT_BANNER);
				this.goalBlueFrameMat.emissive.setHex(RL.goalBlue);
				this.goalOrangeFrameMat.emissive.setHex(RL.goalOrange);
				for (const mat of this.materials) {
					mat.emissiveIntensity = mat === this.bannerMat ? 5.0 : 4.0;
				}
			}
			return;
		}

		if (surgeActive) return;

		this.pulseTime -= dt;
		const pulse = 5.0 + Math.sin(timeSec * 14.5) * 2.4;
		for (const mat of this.materials) {
			mat.emissiveIntensity = pulse;
		}

		if (this.pulseTime <= 0) {
			this.pulseTeam = null;
			this.bannerMat.emissive.setHex(DEFAULT_BANNER);
			this.goalBlueFrameMat.emissive.setHex(RL.goalBlue);
			this.goalOrangeFrameMat.emissive.setHex(RL.goalOrange);
			for (const mat of this.materials) {
				mat.emissiveIntensity = mat === this.bannerMat ? 5.0 : 4.0;
			}
		}
	}

	dispose(): void {
		for (const mat of this.materials) {
			mat.dispose();
		}
	}
}
