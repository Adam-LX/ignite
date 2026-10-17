/**
 * Training Gym v1 — lekkie heurystyki po meczu (human only).
 * Whiff / boost waste / late save / aerial miss — bez Meridian / bez replay.
 */

export type CoachHintId = "whiff" | "boostWaste" | "lateSave" | "aerialMiss";

export type CoachHint = {
	id: CoachHintId;
	/** Ile razy wykryto / sekundy waste. */
	value: number;
	/** 0–1 do sortowania. */
	severity: number;
};

export type CoachTickSample = {
	dt: number;
	/** Dystans human → piłka (m). */
	ballDist: number;
	/** Prędkość zbliżania do piłki (m/s, >0 = zbliża się). */
	closeSpeed: number;
	boostFuel: number;
	boosting: boolean;
	speedMps: number;
	grounded: boolean;
	/** Piłka zagraża własnej bramce. */
	ownGoalThreat: boolean;
	/** Dystans human → własna bramka. */
	ownGoalDist: number;
	/** Wysokość piłki (m) — aerial miss. */
	ballY?: number;
};

const WHIFF_DIST = 2.8;
const WHIFF_CLOSE = 7.5;
const WHIFF_WINDOW = 0.45;
const BOOST_WASTE_SPEED_FRAC = 0.9;
const BOOST_WASTE_BALL_DIST = 22;
const LATE_SAVE_GOAL_DIST = 20;
const LATE_SAVE_BOOST = 0.12;
const AERIAL_BALL_Y = 2.4;
const AERIAL_DIST = 3.4;

export class MatchCoachTracker {
	private whiffArmed = false;
	private whiffTimer = 0;
	private whiffCount = 0;
	private boostWasteSec = 0;
	private lateSaveCount = 0;
	private aerialMissCount = 0;
	private aerialArmed = false;
	private aerialTimer = 0;
	private lastHitAge = 99;

	reset(): void {
		this.whiffArmed = false;
		this.whiffTimer = 0;
		this.whiffCount = 0;
		this.boostWasteSec = 0;
		this.lateSaveCount = 0;
		this.aerialMissCount = 0;
		this.aerialArmed = false;
		this.aerialTimer = 0;
		this.lastHitAge = 99;
	}

	noteBallHit(impact: number): void {
		if (impact > 0.4) this.lastHitAge = 0;
	}

	/** Gol przeciwnika — late save jeśli byliśmy za daleko / bez boosta. */
	noteGoalConceded(sample: {
		ownGoalDist: number;
		boostFuel: number;
	}): void {
		if (
			sample.ownGoalDist > LATE_SAVE_GOAL_DIST ||
			sample.boostFuel < LATE_SAVE_BOOST
		) {
			this.lateSaveCount += 1;
		}
	}

	tick(sample: CoachTickSample): void {
		this.lastHitAge += sample.dt;

		if (
			sample.ballDist < WHIFF_DIST &&
			sample.closeSpeed > WHIFF_CLOSE &&
			this.lastHitAge > 0.2
		) {
			this.whiffArmed = true;
			this.whiffTimer = 0;
		}

		if (this.whiffArmed) {
			this.whiffTimer += sample.dt;
			if (this.lastHitAge < 0.15) {
				this.whiffArmed = false;
				this.whiffTimer = 0;
			} else if (
				this.whiffTimer >= WHIFF_WINDOW &&
				sample.ballDist > WHIFF_DIST + 1.2
			) {
				this.whiffCount += 1;
				this.whiffArmed = false;
				this.whiffTimer = 0;
			} else if (this.whiffTimer > WHIFF_WINDOW + 0.6) {
				this.whiffArmed = false;
				this.whiffTimer = 0;
			}
		}

		const ballY = sample.ballY ?? 0;
		if (
			!sample.grounded &&
			ballY > AERIAL_BALL_Y &&
			sample.ballDist < AERIAL_DIST &&
			sample.closeSpeed > 4 &&
			this.lastHitAge > 0.25
		) {
			this.aerialArmed = true;
			this.aerialTimer = 0;
		}
		if (this.aerialArmed) {
			this.aerialTimer += sample.dt;
			if (this.lastHitAge < 0.15) {
				this.aerialArmed = false;
				this.aerialTimer = 0;
			} else if (
				this.aerialTimer >= 0.5 &&
				(sample.grounded || sample.ballDist > AERIAL_DIST + 2)
			) {
				this.aerialMissCount += 1;
				this.aerialArmed = false;
				this.aerialTimer = 0;
			} else if (this.aerialTimer > 1.2) {
				this.aerialArmed = false;
				this.aerialTimer = 0;
			}
		}

		if (
			sample.boosting &&
			sample.grounded &&
			sample.speedMps >= RL_MAX_SPEED * BOOST_WASTE_SPEED_FRAC &&
			sample.ballDist > BOOST_WASTE_BALL_DIST &&
			!sample.ownGoalThreat
		) {
			this.boostWasteSec += sample.dt;
		}
	}

	summarize(maxHints = 3): CoachHint[] {
		const hints: CoachHint[] = [];
		if (this.whiffCount > 0) {
			hints.push({
				id: "whiff",
				value: this.whiffCount,
				severity: Math.min(1, this.whiffCount / 4),
			});
		}
		if (this.boostWasteSec >= 1.5) {
			hints.push({
				id: "boostWaste",
				value: Math.round(this.boostWasteSec * 10) / 10,
				severity: Math.min(1, this.boostWasteSec / 8),
			});
		}
		if (this.lateSaveCount > 0) {
			hints.push({
				id: "lateSave",
				value: this.lateSaveCount,
				severity: Math.min(1, 0.4 + this.lateSaveCount * 0.25),
			});
		}
		if (this.aerialMissCount > 0) {
			hints.push({
				id: "aerialMiss",
				value: this.aerialMissCount,
				severity: Math.min(1, 0.35 + this.aerialMissCount * 0.22),
			});
		}
		return hints.sort((a, b) => b.severity - a.severity).slice(0, maxHints);
	}
}

/** Unikamy importu RL_CAR w teście jednostkowym ścieżki — lokalny max. */
const RL_MAX_SPEED = 23;
