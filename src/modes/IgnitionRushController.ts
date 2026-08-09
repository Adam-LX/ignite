export type RushPhase = "normal" | "rush";

export type IgnitionRushSnapshot = {
	phase: RushPhase;
	phaseElapsedSec: number;
	nextRushInSec: number | null;
	rushActive: boolean;
};

export type IgnitionRushConfig = {
	intervalSec?: number;
	durationSec?: number;
	ballSpeedMul?: number;
	boostRegenMul?: number;
};

/** Periodic match tempo — experimental playlist only (v0.7). */
export class IgnitionRushController {
	readonly enabled: boolean;
	readonly rushIntervalSec: number;
	readonly rushDurationSec: number;
	readonly ballSpeedMul: number;
	readonly boostRegenMul: number;

	phase: RushPhase = "normal";
	phaseElapsedSec = 0;

	constructor(enabled: boolean, config: IgnitionRushConfig = {}) {
		this.enabled = enabled;
		this.rushIntervalSec = config.intervalSec ?? 90;
		this.rushDurationSec = config.durationSec ?? 20;
		this.ballSpeedMul = config.ballSpeedMul ?? 1.2;
		this.boostRegenMul = config.boostRegenMul ?? 1.3;
	}

	reset(): void {
		this.phase = "normal";
		this.phaseElapsedSec = 0;
	}

	update(dt: number, matchPlaying: boolean): void {
		if (!this.enabled || !matchPlaying) return;

		this.phaseElapsedSec += dt;
		if (this.phase === "normal") {
			if (this.phaseElapsedSec >= this.rushIntervalSec) {
				this.phase = "rush";
				this.phaseElapsedSec = 0;
			}
			return;
		}

		if (this.phaseElapsedSec >= this.rushDurationSec) {
			this.phase = "normal";
			this.phaseElapsedSec = 0;
		}
	}

	isRushActive(): boolean {
		return this.enabled && this.phase === "rush";
	}

	getBallSpeedMul(): number {
		return this.isRushActive() ? this.ballSpeedMul : 1;
	}

	getBoostRegenMul(): number {
		return this.isRushActive() ? this.boostRegenMul : 1;
	}

	snapshot(): IgnitionRushSnapshot {
		const rushActive = this.isRushActive();
		return {
			phase: this.phase,
			phaseElapsedSec: this.phaseElapsedSec,
			nextRushInSec:
				this.enabled && this.phase === "normal"
					? Math.max(0, this.rushIntervalSec - this.phaseElapsedSec)
					: null,
			rushActive,
		};
	}
}
