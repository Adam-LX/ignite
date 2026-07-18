import type * as THREE from "three";

import type { ScoringTeam } from "../game/modes";

export const MERIDIAN_DEADZONE_Z = 1.2;
export const MERIDIAN_POINTS_PER_SEC = 5;
export const MERIDIAN_CROSS_BURST = 8;

export type MeridianHalf = "blue" | "orange" | "neutral";

export type MeridianCrossEvent = {
	from: MeridianHalf;
	to: Exclude<MeridianHalf, "neutral">;
	scoringTeam: ScoringTeam;
	position: { x: number; y: number; z: number };
};

export type MeridianTickResult = {
	blueDelta: number;
	orangeDelta: number;
	cross: MeridianCrossEvent | null;
};

export type MeridianLivePossession = {
	/** Drużyna aktualnie punktująca. */
	team: ScoringTeam;
	/** Całkowity wynik z ułamkiem (do animowanego licznika). */
	liveTotal: number;
};

export function halfForBallZ(z: number, deadzone = MERIDIAN_DEADZONE_Z): MeridianHalf {
	if (z > deadzone) return "orange";
	if (z < -deadzone) return "blue";
	return "neutral";
}

/**
 * Possession w sferze: punkty gdy piłka na połowie przeciwnika.
 * blue gdy z > deadzone (połowa orange); orange gdy z < -deadzone.
 */
export class MeridianController {
	readonly enabled: boolean;
	private blueAcc = 0;
	private orangeAcc = 0;
	private prevHalf: MeridianHalf = "neutral";
	private armed = false;
	private activeScoring: ScoringTeam | null = null;

	constructor(enabled: boolean) {
		this.enabled = enabled;
	}

	reset(): void {
		this.blueAcc = 0;
		this.orangeAcc = 0;
		this.prevHalf = "neutral";
		this.armed = false;
		this.activeScoring = null;
	}

	/**
	 * @param scoringActive — false podczas kickoffu / countdown (nie liczy punktów).
	 */
	update(
		dt: number,
		ballPos: THREE.Vector3,
		scoringActive: boolean,
	): MeridianTickResult {
		const empty: MeridianTickResult = {
			blueDelta: 0,
			orangeDelta: 0,
			cross: null,
		};
		if (!this.enabled || !scoringActive) {
			this.activeScoring = null;
			return empty;
		}

		const half = halfForBallZ(ballPos.z);
		let blueDelta = 0;
		let orangeDelta = 0;
		let cross: MeridianCrossEvent | null = null;

		if (half === "orange") {
			this.blueAcc += MERIDIAN_POINTS_PER_SEC * dt;
			this.activeScoring = "blue";
		} else if (half === "blue") {
			this.orangeAcc += MERIDIAN_POINTS_PER_SEC * dt;
			this.activeScoring = "orange";
		} else {
			this.activeScoring = null;
		}

		if (this.blueAcc >= 1) {
			blueDelta = Math.floor(this.blueAcc);
			this.blueAcc -= blueDelta;
		}
		if (this.orangeAcc >= 1) {
			orangeDelta = Math.floor(this.orangeAcc);
			this.orangeAcc -= orangeDelta;
		}

		if (!this.armed) {
			this.prevHalf = half;
			this.armed = true;
		} else if (
			half !== "neutral" &&
			this.prevHalf !== "neutral" &&
			half !== this.prevHalf
		) {
			const scoringTeam: ScoringTeam =
				half === "orange" ? "blue" : "orange";
			cross = {
				from: this.prevHalf,
				to: half,
				scoringTeam,
				position: { x: ballPos.x, y: ballPos.y, z: ballPos.z },
			};
			if (scoringTeam === "blue") blueDelta += MERIDIAN_CROSS_BURST;
			else orangeDelta += MERIDIAN_CROSS_BURST;
		}

		if (half !== "neutral") {
			this.prevHalf = half;
		}

		return { blueDelta, orangeDelta, cross };
	}

	/** Live licznik — integer score + ułamek akumulacji. */
	getLivePossession(
		blueScore: number,
		orangeScore: number,
	): MeridianLivePossession | null {
		if (!this.enabled || !this.activeScoring) return null;
		if (this.activeScoring === "blue") {
			return {
				team: "blue",
				liveTotal: blueScore + this.blueAcc,
			};
		}
		return {
			team: "orange",
			liveTotal: orangeScore + this.orangeAcc,
		};
	}
}
