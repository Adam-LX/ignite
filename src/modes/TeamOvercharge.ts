import type { ScoringTeam } from "../game/modes";

export type ChargeReason = "save" | "demo" | "dribble";

const CHARGE_BY_REASON: Record<ChargeReason, number> = {
	save: 0.08,
	demo: 0.12,
	dribble: 0.05,
};

export type TeamOverchargeSnapshot = {
	blueCharge: number;
	orangeCharge: number;
	activeTeam: ScoringTeam | null;
	activeLeftSec: number;
};

/** Team charge bar → short overcharge — experimental playlist only (v0.7). */
export class TeamOvercharge {
	readonly enabled: boolean;
	readonly activeDurationSec: number;
	readonly cooldownSec: number;

	private readonly charge: Record<ScoringTeam, number> = {
		blue: 0,
		orange: 0,
	};
	private readonly cooldownLeft: Record<ScoringTeam, number> = {
		blue: 0,
		orange: 0,
	};
	private activeTeam: ScoringTeam | null = null;
	private activeLeftSec = 0;

	constructor(enabled: boolean, opts?: { activeSec?: number; cooldownSec?: number }) {
		this.enabled = enabled;
		this.activeDurationSec = opts?.activeSec ?? 8;
		this.cooldownSec = opts?.cooldownSec ?? 45;
	}

	reset(): void {
		this.charge.blue = 0;
		this.charge.orange = 0;
		this.cooldownLeft.blue = 0;
		this.cooldownLeft.orange = 0;
		this.activeTeam = null;
		this.activeLeftSec = 0;
	}

	update(dt: number, matchPlaying: boolean): void {
		if (!this.enabled || !matchPlaying) return;

		for (const team of ["blue", "orange"] as const) {
			if (this.cooldownLeft[team] > 0) {
				this.cooldownLeft[team] = Math.max(0, this.cooldownLeft[team] - dt);
			}
		}

		if (!this.activeTeam || this.activeLeftSec <= 0) return;
		this.activeLeftSec = Math.max(0, this.activeLeftSec - dt);
		if (this.activeLeftSec <= 0) {
			this.activeTeam = null;
			/** Drużyna, która napełniła pasek podczas OC przeciwnika — odpal teraz. */
			for (const team of ["blue", "orange"] as const) {
				if (this.charge[team] >= 1 && this.cooldownLeft[team] <= 0) {
					this.trigger(team);
					break;
				}
			}
		}
	}

	addCharge(team: ScoringTeam, reason: ChargeReason): void {
		if (!this.enabled) return;
		/** Blokuj tylko drużynę w trakcie własnego OC — przeciwnik może ładować. */
		if (this.activeTeam === team) return;
		if (this.cooldownLeft[team] > 0) return;

		this.charge[team] = Math.min(
			1,
			this.charge[team] + CHARGE_BY_REASON[reason],
		);
		if (this.charge[team] >= 1) {
			this.trigger(team);
		}
	}

	trigger(team: ScoringTeam): void {
		if (!this.enabled) return;
		/** Jeśli przeciwnik ma OC — nie przerywaj; charge wraca do pełnego. */
		if (this.activeTeam && this.activeTeam !== team) {
			this.charge[team] = 1;
			return;
		}
		this.activeTeam = team;
		this.activeLeftSec = this.activeDurationSec;
		this.charge[team] = 0;
		this.cooldownLeft[team] = this.cooldownSec;
	}

	isActive(team?: ScoringTeam): boolean {
		if (!this.enabled || !this.activeTeam || this.activeLeftSec <= 0) {
			return false;
		}
		return team ? this.activeTeam === team : true;
	}

	getCharge(team: ScoringTeam): number {
		return this.charge[team];
	}

	snapshot(): TeamOverchargeSnapshot {
		return {
			blueCharge: this.charge.blue,
			orangeCharge: this.charge.orange,
			activeTeam: this.activeTeam,
			activeLeftSec: this.activeLeftSec,
		};
	}
}
