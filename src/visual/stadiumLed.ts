import * as THREE from "three";

import { goalFrameMaterial, ledBannerMaterial, RL } from "./materials";

const DEFAULT_BANNER = 0x00ffcc;
const PULSE_DURATION = 7.5;

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
	private touchPulseTime = 0;
	private touchPulseTeam: "blue" | "orange" | null = null;
	private matchTension = 0;

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
		this.goalWavePhase = 0;
	}

	private goalWavePhase = 0;

	private applyGoalFrameColors(scoringTeam: "blue" | "orange" | null): void {
		const blueHex = RL.goalBlue;
		const orangeHex = RL.goalOrange;
		if (scoringTeam === "blue") {
			this.goalBlueFrameMat.emissive.setHex(blueHex);
			this.goalOrangeFrameMat.emissive.setHex(orangeHex);
			this.bannerMat.emissive.setHex(blueHex);
			return;
		}
		if (scoringTeam === "orange") {
			this.goalBlueFrameMat.emissive.setHex(blueHex);
			this.goalOrangeFrameMat.emissive.setHex(orangeHex);
			this.bannerMat.emissive.setHex(orangeHex);
			return;
		}
		this.goalBlueFrameMat.emissive.setHex(blueHex);
		this.goalOrangeFrameMat.emissive.setHex(orangeHex);
		this.bannerMat.emissive.setHex(DEFAULT_BANNER);
	}

	pulseBallHit(team: "blue" | "orange", impact: number): void {
		if (impact < 8) return;
		this.touchPulseTeam = team;
		this.touchPulseTime = THREE.MathUtils.clamp(impact / 24, 0.25, 0.55);
	}

	setMatchTension(tension: number): void {
		this.matchTension = THREE.MathUtils.clamp(tension, 0, 1);
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
		if (this.touchPulseTime > 0 && this.touchPulseTeam) {
			this.touchPulseTime = Math.max(0, this.touchPulseTime - dt);
			const k = this.touchPulseTime / 0.55;
			this.applyGoalFrameColors(this.touchPulseTeam);
			for (const mat of this.materials) {
				mat.emissiveIntensity = 4.5 + k * 4 * Math.sin(timeSec * 28);
			}
		}

		const surgeActive = this.surgeColor && this.surgeMix > 0.01;
		if (surgeActive && this.surgeColor) {
			const tensionHz = 14 + this.matchTension * 10;
			const wave =
				4.2 + Math.sin(timeSec * tensionHz + this.surgeWave * 2.8) * 2.8;
			const intensity = wave * (0.55 + this.surgeMix * 0.85);
			for (const mat of this.materials) {
				mat.emissive.copy(this.surgeColor);
				mat.emissiveIntensity = intensity;
			}
			return;
		}

		if (this.touchPulseTime > 0) return;

		if (this.pulseTeam && this.pulseTime > 0) {
			this.pulseTime -= dt;
			this.goalWavePhase += dt * 11;
			const wave = 0.5 + 0.5 * Math.sin(this.goalWavePhase);
			const ripple = 0.5 + 0.5 * Math.sin(this.goalWavePhase * 1.7 + 0.8);
			const pulse =
				5.5 + Math.sin(timeSec * (16.5 + this.matchTension * 9)) * 2.6;
			this.applyGoalFrameColors(this.pulseTeam);
			const scoreMat =
				this.pulseTeam === "blue"
					? this.goalBlueFrameMat
					: this.goalOrangeFrameMat;
			for (const mat of this.materials) {
				const isBanner = mat === this.bannerMat;
				mat.emissiveIntensity =
					mat === scoreMat
						? pulse + this.matchTension * 2.4 + wave * 2.2
						: isBanner
							? pulse + ripple * 4.5 + wave * 2.8
							: 4.2 + this.matchTension * 0.85 + wave * 0.6;
			}
			if (this.pulseTime <= 0) {
				this.pulseTeam = null;
			}
			return;
		}

		this.applyGoalFrameColors(null);
		const base = 5.0 + this.matchTension * 1.2;
		for (const mat of this.materials) {
			mat.emissiveIntensity =
				mat === this.bannerMat
					? base
					: 4.0 +
						this.matchTension +
						Math.sin(timeSec * (6 + this.matchTension * 12)) *
							this.matchTension;
		}
	}

	dispose(): void {
		for (const mat of this.materials) {
			mat.dispose();
		}
	}
}
