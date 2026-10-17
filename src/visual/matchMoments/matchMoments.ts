import * as THREE from "three";

import type {
	BallTouchRecord,
	GoalTouchContext,
} from "../../game/BallTouchTracker";
import type { CarEntity } from "../../game/CarEntity";
import type { GameModeId, ScoringTeam } from "../../game/modes";
import { isIgnitionMode } from "../../game/modes";
import { RL_ARENA } from "../arenaConstants";
import { SUPERSONIC_MPS } from "../supersonicBreak";

const GOAL_BLUE = new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH);
const GOAL_ORANGE = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);

export type MatchMomentId =
	| "assist"
	| "playmaker"
	| "overtime_winner"
	| "aerial"
	| "aerial_goal"
	| "ignite_signature"
	| "long_shot"
	| "from_midfield"
	| "double_tap"
	| "wall_shot"
	| "ceiling_shot"
	| "flip_reset"
	| "buzzer_beater"
	| "game_winner"
	| "own_goal"
	| "demo_chain"
	| "demo_and_score"
	| "kickoff_goal"
	| "on_fire"
	| "unstoppable"
	| "supersonic_demo";

export type MatchMomentSpec = {
	id: MatchMomentId;
	label: string;
	priority: number;
	intensity: number;
	duration: number;
	cooldown: number;
};

export type GoalMomentInput = {
	scoringTeam: ScoringTeam;
	touch: GoalTouchContext;
	cars: CarEntity[];
	humanCar: CarEntity;
	mode: GameModeId;
	isOvertime: boolean;
	isGoldenGoal: boolean;
	isKickoffWindow: boolean;
	matchTimeSec: number;
	timeRemainingSec: number;
	matchEndsAfterGoal: boolean;
	humanGoalStreak: number;
	hadPowerUp: boolean;
	recentWall: boolean;
	recentCeiling: boolean;
	doubleTapReady: boolean;
};

export type HumanHitMomentInput = {
	impact: number;
	ballY: number;
	inAir: boolean;
	flipping: boolean;
	onWall: boolean;
	matchTimeSec: number;
	/** Fizyczny flip reset (wheels-on-ball) — nie sam aerial hit. */
	flipReset?: boolean;
};

export type DemoMomentInput = {
	impact: number;
	humanAttacker: boolean;
	humanSpeedMps: number;
	matchTimeSec: number;
};

const LONG_SHOT_MIN = 35;
const MIDFIELD_MIN = 50;
const AERIAL_BALL_Y = 2.35;

export function goalCenterForTeam(team: ScoringTeam): THREE.Vector3 {
	return team === "blue" ? GOAL_BLUE : GOAL_ORANGE;
}

export function shotDistanceFromTouch(
	touch: BallTouchRecord | null,
	scoringTeam: ScoringTeam,
): number {
	if (!touch) return 0;
	return touch.carPos.distanceTo(goalCenterForTeam(scoringTeam));
}

export function pickGoalMoment(input: GoalMomentInput): MatchMomentSpec | null {
	const scorer =
		input.touch.scorerSlot !== null
			? input.cars.find((c) => c.slotIndex === input.touch.scorerSlot)
			: null;
	const humanScored = scorer?.isHuman ?? false;
	const last = input.touch.lastTouch;
	const candidates: MatchMomentSpec[] = [];

	if (input.touch.isOwnGoal && scorer?.isHuman) {
		candidates.push(spec("own_goal", "OWN GOAL!", 100, 1, 1.1, 2.5));
	}

	if (humanScored && input.isGoldenGoal) {
		candidates.push(
			spec("overtime_winner", "OVERTIME WINNER!", 96, 1, 1.25, 2.8),
		);
	}

	if (humanSideWinsMatch(input)) {
		candidates.push(spec("game_winner", "GAME WINNER!", 92, 1, 1.15, 2.6));
	}

	if (humanScored && input.isKickoffWindow) {
		candidates.push(spec("kickoff_goal", "KICKOFF GOAL!", 88, 0.95, 0.95, 2.2));
	}

	if (
		humanScored &&
		!input.isOvertime &&
		input.timeRemainingSec <= 3 &&
		input.timeRemainingSec >= 0
	) {
		candidates.push(
			spec("buzzer_beater", "BUZZER BEATER!", 86, 0.92, 1.05, 2.4),
		);
	}

	if (humanScored && input.doubleTapReady) {
		candidates.push(spec("double_tap", "DOUBLE TAP!", 78, 0.9, 0.88, 2));
	}

	if (humanScored && input.recentCeiling) {
		candidates.push(spec("ceiling_shot", "CEILING SHOT!", 76, 0.88, 0.9, 2));
	} else if (humanScored && input.recentWall) {
		candidates.push(spec("wall_shot", "WALL SHOT!", 74, 0.85, 0.88, 2));
	}

	if (humanScored && (last?.inAir || (last?.ballY ?? 0) >= AERIAL_BALL_Y)) {
		/** Stylowy aerial (flip / mocny hit) → unikalny Ignite Signature. */
		const stylish =
			Boolean(last?.flipping) || (last?.impact ?? 0) >= 9;
		if (stylish) {
			candidates.push(
				spec(
					"ignite_signature",
					"IGNITE SIGNATURE!",
					81,
					0.96,
					1.15,
					2.5,
				),
			);
		} else {
			candidates.push(spec("aerial_goal", "AERIAL GOAL!", 72, 0.88, 1, 2.2));
		}
	}

	const dist = shotDistanceFromTouch(last, input.scoringTeam);
	if (humanScored && dist >= MIDFIELD_MIN) {
		candidates.push(
			spec("from_midfield", "FROM MIDFIELD!", 70, 0.9, 0.95, 2.1),
		);
	} else if (humanScored && dist >= LONG_SHOT_MIN) {
		candidates.push(spec("long_shot", "LONG SHOT!", 68, 0.82, 0.9, 2));
	}

	if (humanScored && input.humanGoalStreak >= 3) {
		candidates.push(spec("unstoppable", "UNSTOPPABLE!", 66, 1, 1.05, 2.5));
	} else if (humanScored && input.humanGoalStreak >= 2) {
		candidates.push(spec("on_fire", "ON FIRE!", 62, 0.85, 0.95, 2.2));
	}

	if (humanScored && input.hadPowerUp) {
		candidates.push(spec("on_fire", "POWER PLAY!", 60, 0.8, 0.85, 2));
	}

	if (candidates.length === 0) return null;
	candidates.sort((a, b) => b.priority - a.priority);
	return candidates[0]!;
}

export function pickAssistMoment(
	assistCar: CarEntity | undefined,
	prevTouch: BallTouchRecord | null,
): MatchMomentSpec | null {
	if (!assistCar?.isHuman || !prevTouch) return null;
	const aerial =
		prevTouch.inAir ||
		prevTouch.ballY >= AERIAL_BALL_Y ||
		prevTouch.impact >= 8;
	const label = aerial || prevTouch.impact >= 10 ? "PLAYMAKER!" : "ASSIST!";
	const id: MatchMomentId = aerial ? "playmaker" : "assist";
	return spec(id, label, 58, 0.75, 0.82, 2);
}

export function pickHumanHitMoment(
	input: HumanHitMomentInput,
): MatchMomentSpec | null {
	if (input.flipReset) {
		return spec("flip_reset", "FLIP RESET!", 42, 0.55, 0.62, 1.05);
	}
	if (input.inAir && input.ballY >= AERIAL_BALL_Y && input.impact >= 4) {
		return spec("aerial", "AERIAL!", 38, 0.65, 0.7, 1.2);
	}
	/** Dodge / flip w powietrzu przy solidnym hicie — feedback zanim padnie aerial_goal. */
	if (input.flipping && input.inAir && input.impact >= 5) {
		return spec("aerial", "FLIP HIT!", 36, 0.58, 0.58, 1.15);
	}
	// Wall ride hit — feedback zanim padnie gol (recentWall na goal moment).
	if (input.onWall && input.impact >= 5.5) {
		return spec("wall_shot", "WALL HIT!", 34, 0.55, 0.55, 1.4);
	}
	return null;
}

export function pickDemoMoment(
	input: DemoMomentInput,
	demoChainCount: number,
	scoredSoonAfter: boolean,
): MatchMomentSpec | null {
	if (input.humanAttacker && input.humanSpeedMps >= SUPERSONIC_MPS) {
		return spec("supersonic_demo", "SUPERSONIC BUMP!", 52, 0.88, 0.85, 1.8);
	}
	if (input.humanAttacker && scoredSoonAfter) {
		return spec("demo_and_score", "DEMO AND SCORE!", 54, 0.9, 0.9, 2);
	}
	if (input.humanAttacker && demoChainCount >= 2) {
		return spec("demo_chain", "DEMO CHAIN!", 50, 0.82, 0.8, 1.6);
	}
	return null;
}

function spec(
	id: MatchMomentId,
	label: string,
	priority: number,
	intensity: number,
	duration: number,
	cooldown: number,
): MatchMomentSpec {
	return { id, label, priority, intensity, duration, cooldown };
}

function humanSideWinsMatch(input: GoalMomentInput): boolean {
	if (!input.matchEndsAfterGoal) return false;
	if (isIgnitionMode(input.mode)) {
		const top = [...input.cars].sort(
			(a, b) => b.individualScore - a.individualScore,
		);
		return top[0]?.isHuman ?? false;
	}
	const humanTeam = input.humanCar.team;
	if (!humanTeam) return false;
	return input.scoringTeam === humanTeam && !input.touch.isOwnGoal;
}

export type MatchMomentPresentation = {
	flash: number;
	streak: number;
	bloom: number;
	fovBoost: number;
	shake: number;
	label: string;
	momentId: MatchMomentId | "";
};

/** Unified banner/flash dla wszystkich dodatkowych momentów meczowych. */
export class MatchMomentHighlight {
	private active = false;
	private elapsed = 0;
	private cooldown = 0;
	private intensity = 0;
	private duration = 0.85;
	private label = "";
	private momentId: MatchMomentId | "" = "";

	trigger(specIn: MatchMomentSpec): boolean {
		if (this.cooldown > 0) return false;
		this.active = true;
		this.elapsed = 0;
		this.cooldown = specIn.cooldown;
		this.intensity = specIn.intensity;
		this.duration = specIn.duration;
		this.label = specIn.label;
		this.momentId = specIn.id;
		return true;
	}

	/** Kickoff / reset meczu — bez leak double-tap / flash między rundami. */
	reset(): void {
		this.active = false;
		this.elapsed = 0;
		this.cooldown = 0;
		this.intensity = 0;
		this.label = "";
		this.momentId = "";
	}

	update(dt: number): void {
		this.cooldown = Math.max(0, this.cooldown - dt);
		if (!this.active) return;
		this.elapsed += dt;
		if (this.elapsed >= this.duration) {
			this.active = false;
			this.momentId = "";
		}
	}

	isActive(): boolean {
		return this.active;
	}

	getPresentation(): MatchMomentPresentation {
		if (!this.active) {
			return {
				flash: 0,
				streak: 0,
				bloom: 0,
				fovBoost: 0,
				shake: 0,
				label: "",
				momentId: "",
			};
		}

		const t = this.elapsed;
		const k = this.intensity;
		const flash =
			t < 0.045
				? (1 - t / 0.045) * k
				: Math.max(0, 0.26 * k * (1 - (t - 0.045) / 0.22));
		const streak =
			t < 0.035
				? (t / 0.035) * k
				: t < 0.42
					? k * (1 - (t - 0.035) / 0.385)
					: 0;
		const bloom =
			t < 0.09
				? (t / 0.09) * k * 0.82
				: Math.max(0, k * (1 - (t - 0.09) / 0.45) * 0.68);
		const fovBoost = t < 0.14 ? THREE.MathUtils.lerp(4 * k, 1.0, t / 0.14) : 0;
		const shake = t < 0.28 ? THREE.MathUtils.lerp(0.22 * k, 0.04, t / 0.28) : 0;

		return {
			flash,
			streak,
			bloom,
			fovBoost,
			shake,
			label: this.label,
			momentId: this.momentId,
		};
	}
}

export function applyMatchMomentOverlay(
	presentation: MatchMomentPresentation,
): void {
	const flashEl = document.getElementById("match-moment-flash");
	const bannerEl = document.getElementById("match-moment-banner");
	if (!flashEl || !bannerEl) return;

	if (presentation.flash <= 0.01 && presentation.streak <= 0.01) {
		flashEl.style.opacity = "0";
		bannerEl.classList.remove("show");
		bannerEl.removeAttribute("data-moment");
		return;
	}

	if (presentation.momentId) {
		bannerEl.dataset.moment = presentation.momentId;
		flashEl.dataset.moment = presentation.momentId;
	}

	flashEl.style.opacity = String(
		THREE.MathUtils.clamp(presentation.flash * 0.68, 0, 1),
	);
	flashEl.style.setProperty(
		"--streak",
		String(THREE.MathUtils.clamp(presentation.streak, 0, 1)),
	);

	if (presentation.label) {
		bannerEl.textContent = presentation.label;
	}

	if (presentation.flash > 0.24 || presentation.streak > 0.38) {
		bannerEl.classList.add("show");
	} else if (presentation.streak <= 0.1) {
		bannerEl.classList.remove("show");
	}
}
