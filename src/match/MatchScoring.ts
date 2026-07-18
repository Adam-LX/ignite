import * as THREE from "three";

import { ballThreatensOwnGoal } from "../ai/botTactics";
import type { GoalTouchContext } from "../game/BallTouchTracker";
import type { CarEntity } from "../game/CarEntity";
import type { ScoringTeam } from "../game/modes";
import { RL_ARENA } from "../visual/arenaConstants";
import {
	EPIC_SAVE_IMPACT_MIN,
	EPIC_SAVE_MAX_GOAL_DIST,
	ownGoalForTeam,
} from "../visual/epicSaveHighlight";

/** Oficjalne wartości Rocket League (+ touch jak w custom serwerach). */
export const RL_SCORE_POINTS = {
	GOAL: 100,
	ASSIST: 50,
	SAVE: 50,
	EPIC_SAVE: 75,
	CENTER: 50,
	TOUCH: 2,
} as const;

export type PlayerStatLine = {
	slotIndex: number;
	score: number;
	goals: number;
	assists: number;
	saves: number;
	centers: number;
	touches: number;
	shots: number;
	lastTouchScoreAt: number;
	lastCenterAt: number;
	lastSaveAt: number;
};

export type ScoreboardRow = {
	slotIndex: number;
	name: string;
	team: ScoringTeam | null;
	isHuman: boolean;
	score: number;
	goals: number;
	assists: number;
	saves: number;
	centers: number;
	touches: number;
	shots: number;
};

const TOUCH_SCORE_IMPACT_MIN = 4;
const TOUCH_SCORE_COOLDOWN_SEC = 0.45;
const CENTER_COOLDOWN_SEC = 1.4;
const SAVE_COOLDOWN_SEC = 2.2;
const CENTER_MIN_SPEED = 9;
const SHOT_MIN_SPEED = 11;

const _toGoal = new THREE.Vector3();

/** Piłka leci w stronę bramki przeciwnika z odpowiednią prędkością. */
export function ballVelTowardGoal(
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	goalPos: THREE.Vector3,
	minSpeed = 8,
): number {
	_toGoal.copy(goalPos).sub(ballPos);
	_toGoal.y = 0;
	if (_toGoal.lengthSq() < 0.01) return 0;
	_toGoal.normalize();
	const flat = new THREE.Vector3(ballVel.x, 0, ballVel.z);
	const toward = flat.dot(_toGoal);
	return toward >= minSpeed ? toward : 0;
}

/** Dośrodkowanie — dotknięcie w połowie przeciwnika, piłka leci w bramkę w strefie penalty. */
export function evaluateCenter(
	team: ScoringTeam,
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
): boolean {
	const oppGoalZ =
		team === "blue" ? RL_ARENA.HALF_LENGTH : -RL_ARENA.HALF_LENGTH;
	const inOppHalf = team === "blue" ? ballPos.z > 2 : ballPos.z < -2;
	if (!inOppHalf) return false;

	const goalPos = new THREE.Vector3(0, 0, oppGoalZ);
	if (ballVelTowardGoal(ballPos, ballVel, goalPos, CENTER_MIN_SPEED) <= 0) {
		return false;
	}

	const distToGoal = Math.abs(ballPos.z - oppGoalZ);
	const inBox =
		Math.abs(ballPos.x) <= RL_ARENA.GOAL_WIDTH * 0.55 + 2 &&
		distToGoal <= RL_ARENA.GOAL_DEPTH + 8;
	return inBox;
}

export function evaluateShot(
	team: ScoringTeam,
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
): boolean {
	const oppGoalZ =
		team === "blue" ? RL_ARENA.HALF_LENGTH : -RL_ARENA.HALF_LENGTH;
	const goalPos = new THREE.Vector3(0, 0, oppGoalZ);
	return ballVelTowardGoal(ballPos, ballVel, goalPos, SHOT_MIN_SPEED) > 0;
}

export type SaveKind = "epic" | "save";

export function evaluateSaveKind(
	team: ScoringTeam,
	ballPos: THREE.Vector3,
	ballVelBefore: THREE.Vector3,
	hitImpact: number,
): SaveKind | null {
	if (hitImpact < 3) return null;
	const ownGoal = ownGoalForTeam(team);
	if (!ballThreatensOwnGoal(ballPos, ballVelBefore, ownGoal, 1.6)) {
		return null;
	}
	const dist = ballPos.distanceTo(ownGoal);
	if (dist > 34) return null;
	if (hitImpact >= EPIC_SAVE_IMPACT_MIN && dist <= EPIC_SAVE_MAX_GOAL_DIST) {
		return "epic";
	}
	return "save";
}

export class MatchScoring {
	private readonly stats = new Map<number, PlayerStatLine>();

	ensurePlayers(cars: CarEntity[]): void {
		for (const car of cars) {
			if (this.stats.has(car.slotIndex)) continue;
			this.stats.set(car.slotIndex, this.emptyLine(car.slotIndex));
		}
	}

	reset(): void {
		this.stats.clear();
	}

	private emptyLine(slotIndex: number): PlayerStatLine {
		return {
			slotIndex,
			score: 0,
			goals: 0,
			assists: 0,
			saves: 0,
			centers: 0,
			touches: 0,
			shots: 0,
			lastTouchScoreAt: -999,
			lastCenterAt: -999,
			lastSaveAt: -999,
		};
	}

	private line(slotIndex: number): PlayerStatLine {
		let line = this.stats.get(slotIndex);
		if (!line) {
			line = this.emptyLine(slotIndex);
			this.stats.set(slotIndex, line);
		}
		return line;
	}

	onBallHit(
		car: CarEntity,
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		impact: number,
		nowSec: number,
	): void {
		if (impact <= 0) return;
		const s = this.line(car.slotIndex);
		s.touches++;

		if (
			impact >= TOUCH_SCORE_IMPACT_MIN &&
			nowSec - s.lastTouchScoreAt >= TOUCH_SCORE_COOLDOWN_SEC
		) {
			s.score += RL_SCORE_POINTS.TOUCH;
			s.lastTouchScoreAt = nowSec;
		}

		if (car.team) {
			if (
				evaluateCenter(car.team, ballPos, ballVel) &&
				nowSec - s.lastCenterAt >= CENTER_COOLDOWN_SEC
			) {
				s.centers++;
				s.score += RL_SCORE_POINTS.CENTER;
				s.lastCenterAt = nowSec;
			}
			if (evaluateShot(car.team, ballPos, ballVel)) {
				s.shots++;
			}
		}
	}

	onDefensiveClear(
		car: CarEntity,
		ballPos: THREE.Vector3,
		ballVelBefore: THREE.Vector3,
		impact: number,
		nowSec: number,
	): void {
		if (!car.team) return;
		const kind = evaluateSaveKind(car.team, ballPos, ballVelBefore, impact);
		if (!kind) return;
		const s = this.line(car.slotIndex);
		if (nowSec - s.lastSaveAt < SAVE_COOLDOWN_SEC) return;
		s.saves++;
		s.score +=
			kind === "epic" ? RL_SCORE_POINTS.EPIC_SAVE : RL_SCORE_POINTS.SAVE;
		s.lastSaveAt = nowSec;
	}

	applyGoal(touch: GoalTouchContext, _cars: CarEntity[], isFFA: boolean): void {
		if (isFFA) {
			const slot = touch.scorerSlot;
			if (slot !== null) {
				const s = this.line(slot);
				s.goals++;
				s.score += RL_SCORE_POINTS.GOAL;
			}
			return;
		}

		if (touch.scorerSlot !== null) {
			const s = this.line(touch.scorerSlot);
			s.goals++;
			s.score += RL_SCORE_POINTS.GOAL;
		}
		if (touch.assistSlot !== null) {
			const a = this.line(touch.assistSlot);
			a.assists++;
			a.score += RL_SCORE_POINTS.ASSIST;
		}
	}

	getRows(cars: CarEntity[]): ScoreboardRow[] {
		return cars
			.map((car) => {
				const s = this.line(car.slotIndex);
				return {
					slotIndex: car.slotIndex,
					name: car.displayName,
					team: car.team ?? car.visualTeam,
					isHuman: car.isHuman,
					score: s.score,
					goals: s.goals,
					assists: s.assists,
					saves: s.saves,
					centers: s.centers,
					touches: s.touches,
					shots: s.shots,
				};
			})
			.sort((a, b) => b.score - a.score || b.goals - a.goals);
	}

	exportPayload(): Array<
		Omit<PlayerStatLine, "lastTouchScoreAt" | "lastCenterAt" | "lastSaveAt">
	> {
		return [...this.stats.values()].map(
			({ lastTouchScoreAt: _a, lastCenterAt: _b, lastSaveAt: _c, ...rest }) =>
				rest,
		);
	}

	applyPayload(
		payload: Array<
			Omit<PlayerStatLine, "lastTouchScoreAt" | "lastCenterAt" | "lastSaveAt">
		>,
	): void {
		this.stats.clear();
		for (const row of payload) {
			this.stats.set(row.slotIndex, {
				...row,
				lastTouchScoreAt: -999,
				lastCenterAt: -999,
				lastSaveAt: -999,
			});
		}
	}
}
