import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import type GameObject from "../GameObject";
import {
	BallTouchTracker,
	type GoalTouchContext,
} from "../game/BallTouchTracker";
import type { CarEntity } from "../game/CarEntity";
import type { GameModeId, ScoringTeam } from "../game/modes";
import { getModeSpec, MATCH_RULES } from "../game/modes";
import { t } from "../i18n";
import { detectGoalScored, getStadiumLeds } from "../visual/arena";
import { RL_ARENA } from "../visual/arenaConstants";
import { GoalVfx } from "../visual/vfx/goalVfx";

export type MatchPhase =
	| "countdown"
	| "playing"
	| "goal_bounce"
	| "goal_replay"
	| "goal_pause"
	| "finished";

export type SpawnRole = "defensive" | "offensive_corner" | "center_back";

export type CarSpawn = {
	slotIndex: number;
	team: ScoringTeam | null;
	displayName: string;
	position: THREE.Vector3;
	yaw: number;
	visualTeam: ScoringTeam;
	spawnRole: SpawnRole;
};

export type MatchHudSnapshot = {
	phase: MatchPhase;
	timeRemainingSec: number;
	blueScore: number;
	orangeScore: number;
	isFFA: boolean;
	ffaScores: { name: string; score: number; isHuman: boolean }[];
	goalTeam: ScoringTeam | null;
	goalScorerName: string | null;
	resetCountdown: number | null;
	countdownSec: number | null;
	kickoffTick: number | null;
	kickoffIgnite: boolean;
	overtimeBanner: boolean;
	isOvertime: boolean;
	winnerLabel: string | null;
	replayActive: boolean;
};

import { buildRlKickoffSpawns } from "../game/rlKickoffSpawns";

const IGNITION_RADIUS = 14;
const IGNITION_NAMES = [
	"Spark",
	"Flash",
	"Blaze",
	"Ember",
	"Surge",
	"Volt",
	"Nova",
	"Flare",
];

const IGNITE_FLASH_SEC = 1.0;
const OVERTIME_BANNER_SEC = 2.5;
/** Okno po kickoffzie — kickoff goal highlight. */
const KICKOFF_GOAL_WINDOW_SEC = 3.0;
/** Live odbijanie piłki w siatce po golu (fizyka dalej działa). */
const GOAL_BOUNCE_SEC = 2.0;
/** Ile sekund akcji przed bramką w replayu. */
const REPLAY_PRE_SEC = 4.8;
/** Fragment po linii bramkowej (nagrywany w goal_bounce). */
const REPLAY_POST_SEC = 2.0;
/** Pauza po teleporcie — tylna kamera ustawiona, dopiero potem odliczanie. */
const POST_GOAL_SETUP_SEC = 1.15;
/** Krótka pauza po golden goal zamiast kickoffu. */
const GOLDEN_GOAL_CELEBRATION_SEC = 2.25;

export function buildSpawnPositions(
	mode: GameModeId,
	carHalfHeight: number,
): CarSpawn[] {
	if (mode === "ignition") {
		return buildIgnitionSpawns(carHalfHeight);
	}
	if (mode === "ignition1v1") {
		return buildIgnition1v1Spawns(carHalfHeight);
	}
	return buildTeamSpawns(mode, carHalfHeight);
}

export class MatchController {
	private readonly goalVfx: GoalVfx;
	private readonly mode: GameModeId;
	private readonly isFFA: boolean;
	private readonly touchTracker = new BallTouchTracker();

	private phase: MatchPhase = "countdown";
	private timeRemainingSec: number = MATCH_RULES.durationSec;
	private countdownLeft: number = MATCH_RULES.countdownSec;
	private goalBounceLeft = 0;
	private goalCelebrationLeft = 0;
	private goalEventTime = 0;
	private postGoalResetDone = false;
	private postGoalSetupLeft = 0;
	private countdownHold = false;
	private blueScore = 0;
	private orangeScore = 0;

	private goalLock: ScoringTeam | null = null;
	private lastScoringTeam: ScoringTeam | null = null;
	private lastGoalScorerName: string | null = null;
	private pendingGoalFlash: ScoringTeam | null = null;
	private spawns: CarSpawn[] = [];
	private matchTime = 0;
	private kickoffWindowLeft = 0;
	private kickoffIgniteLeft = 0;
	private isOvertime = false;
	private overtimeBannerLeft = 0;
	private pendingOvertimeStart = false;
	private finishAfterGoal = false;
	private skipGoalReplay = false;
	private pendingGoalMoment: GoalMomentSnapshot | null = null;

	constructor(scene: THREE.Scene, mode: GameModeId) {
		this.goalVfx = new GoalVfx(scene);
		this.mode = mode;
		this.isFFA = getModeSpec(mode).isFFA;
	}

	initSpawns(carHalfHeight: number): CarSpawn[] {
		this.spawns = buildSpawnPositions(this.mode, carHalfHeight);
		return this.spawns;
	}

	getSpawn(slotIndex: number): CarSpawn {
		const s = this.spawns[slotIndex];
		if (!s) throw new Error(`Brak spawnu ${slotIndex}`);
		return s;
	}

	update(
		dt: number,
		world: RAPIER.World,
		ball: GameObject,
		cars: CarEntity[],
		ballRadius: number,
		carHalfHeight: number,
	): ScoringTeam | null {
		this.goalVfx.update(dt);
		this.matchTime += dt;

		if (this.phase === "countdown") {
			return null;
		}

		if (this.phase === "finished") {
			return null;
		}

		if (this.phase === "goal_bounce") {
			this.freezeCarsOnly(cars);
			this.softContainBallInNet(
				ball,
				ballRadius,
				this.goalLock ?? this.lastScoringTeam ?? "blue",
				dt,
			);
			this.goalBounceLeft = Math.max(0, this.goalBounceLeft - dt);
			if (this.goalBounceLeft <= 0) {
				this.phase = this.skipGoalReplay ? "goal_pause" : "goal_replay";
			}
			return null;
		}

		if (this.phase === "goal_replay") {
			this.freezeAllPhysics(cars, ball);
			return null;
		}

		if (this.phase === "goal_pause") {
			this.freezeAllPhysics(cars, ball);
			if (!this.postGoalResetDone) {
				if (this.pendingOvertimeStart) {
					this.performKickoffReset(ball, cars, carHalfHeight);
					this.postGoalResetDone = true;
					this.postGoalSetupLeft = POST_GOAL_SETUP_SEC;
					this.pendingOvertimeStart = false;
					return null;
				}

				if (this.finishAfterGoal) {
					this.goalCelebrationLeft = Math.max(0, this.goalCelebrationLeft - dt);
					if (this.goalCelebrationLeft <= 0) {
						this.phase = "finished";
						this.finishAfterGoal = false;
						this.goalLock = null;
						this.postGoalResetDone = true;
					}
					return null;
				}

				this.goalCelebrationLeft = Math.max(0, this.goalCelebrationLeft - dt);
				if (this.goalCelebrationLeft <= 0) {
					this.performKickoffReset(ball, cars, carHalfHeight);
					this.postGoalResetDone = true;
					this.postGoalSetupLeft = POST_GOAL_SETUP_SEC;
					this.countdownLeft = MATCH_RULES.countdownSec;
					this.kickoffIgniteLeft = 0;
				}
				return null;
			}

			if (this.postGoalSetupLeft > 0) {
				this.postGoalSetupLeft = Math.max(0, this.postGoalSetupLeft - dt);
				return null;
			}

			if (this.isOvertime && this.overtimeBannerLeft > 0) {
				const prev = this.overtimeBannerLeft;
				this.overtimeBannerLeft = Math.max(0, this.overtimeBannerLeft - dt);
				if (prev > 0 && this.overtimeBannerLeft <= 0) {
					this.countdownLeft = MATCH_RULES.countdownSec;
				}
				return null;
			}

			if (this.kickoffIgniteLeft > 0) {
				this.kickoffIgniteLeft = Math.max(0, this.kickoffIgniteLeft - dt);
				if (this.kickoffIgniteLeft <= 0) {
					if (this.finishAfterGoal) {
						this.phase = "finished";
						this.finishAfterGoal = false;
						this.goalLock = null;
						this.postGoalResetDone = false;
					} else {
						this.phase = "playing";
						this.goalLock = null;
						this.postGoalResetDone = false;
						this.kickoffWindowLeft = 2.5;
						if (this.timeRemainingSec <= 0 && !this.isOvertime) {
							if (this.isScoreTied(cars)) {
								this.beginOvertimeFromPause(ball, cars);
							} else {
								this.phase = "finished";
							}
						}
					}
				}
				return null;
			}

			this.countdownLeft -= dt;
			if (this.countdownLeft <= 0) {
				this.countdownLeft = 0;
				this.kickoffIgniteLeft = IGNITE_FLASH_SEC;
			}
			return null;
		}

		if (!this.isOvertime) {
			this.timeRemainingSec -= dt;
			if (this.timeRemainingSec <= 0) {
				this.timeRemainingSec = 0;
				if (this.isScoreTied(cars)) {
					this.beginOvertimeFromPlay(ball, cars);
				} else {
					this.phase = "finished";
					this.freezeAllPhysics(cars, ball);
				}
				return null;
			}
		}

		if (this.kickoffWindowLeft > 0) {
			this.kickoffWindowLeft = Math.max(0, this.kickoffWindowLeft - dt);
		}

		this.touchTracker.update(world, cars, ball, this.matchTime);

		const scored = detectGoalScored(ball.getPosition(), ballRadius);
		if (!scored || scored === this.goalLock) {
			if (!scored) this.goalLock = null;
			return null;
		}

		this.goalLock = scored;
		this.phase = "goal_bounce";
		this.goalBounceLeft = GOAL_BOUNCE_SEC;
		this.goalEventTime = this.matchTime;
		this.postGoalResetDone = false;
		this.postGoalSetupLeft = 0;
		this.countdownLeft = MATCH_RULES.countdownSec;
		this.kickoffIgniteLeft = 0;
		this.overtimeBannerLeft = 0;
		if (this.isOvertime) {
			this.finishAfterGoal = true;
		}
		this.lastScoringTeam = scored;
		this.pendingGoalFlash = scored;
		this.freezeCarsOnly(cars);

		if (this.isFFA) {
			const slot = this.touchTracker.getScorerSlot(0);
			const car = cars.find((c) => c.slotIndex === slot) ?? cars[0];
			if (car) {
				car.individualScore++;
				this.lastGoalScorerName = car.displayName;
			}
		} else {
			if (scored === "blue") this.blueScore++;
			else this.orangeScore++;
			this.lastGoalScorerName = scored === "blue" ? "BLUE" : "ORANGE";
		}

		this.pendingGoalMoment = {
			scoringTeam: scored,
			touch: this.touchTracker.buildGoalContext(scored, cars, this.isFFA),
			isOvertime: this.isOvertime,
			isGoldenGoal: this.isOvertime,
			isKickoffWindow:
				this.kickoffWindowLeft > 0 || this.matchTime < KICKOFF_GOAL_WINDOW_SEC,
			timeRemainingSec: this.timeRemainingSec,
			matchEndsAfterGoal: this.willMatchEndAfterGoal(cars),
		};

		getStadiumLeds()?.onGoal(scored);
		const goalPos = this.goalCenter(scored);
		this.goalVfx.trigger(goalPos, scored);

		return scored;
	}

	isCarsFrozen(): boolean {
		return (
			this.phase === "goal_bounce" ||
			this.phase === "goal_replay" ||
			this.phase === "goal_pause" ||
			this.phase === "finished"
		);
	}

	isBallSimActive(): boolean {
		return this.phase === "playing" || this.phase === "goal_bounce";
	}

	isReplayActive(): boolean {
		return this.phase === "goal_replay";
	}

	getPhase(): MatchPhase {
		return this.phase;
	}

	getLastScoringTeam(): ScoringTeam | null {
		return this.lastScoringTeam;
	}

	shouldRecordReplay(): boolean {
		return this.phase === "playing" || this.phase === "goal_bounce";
	}

	getGoalEventTime(): number {
		return this.goalEventTime;
	}

	getReplayPreSec(): number {
		return REPLAY_PRE_SEC;
	}

	getReplayPostSec(): number {
		return REPLAY_POST_SEC;
	}

	finishReplay(): void {
		if (this.phase !== "goal_replay") return;
		this.phase = "goal_pause";
		this.postGoalResetDone = false;
		if (this.finishAfterGoal) {
			this.goalCelebrationLeft = GOLDEN_GOAL_CELEBRATION_SEC;
			this.postGoalSetupLeft = 0;
			this.countdownLeft = 0;
			this.kickoffIgniteLeft = 0;
		} else {
			this.goalCelebrationLeft = 0;
		}
	}

	skipReplay(): void {
		if (this.phase !== "goal_replay") return;
		this.finishReplay();
	}

	isKickoffActive(): boolean {
		return this.phase === "playing" && this.kickoffWindowLeft > 0;
	}

	isKickoffCountdownActive(): boolean {
		return this.phase === "countdown" || this.kickoffIgniteLeft > 0;
	}

	/** Blokada jazdy podczas 5…1 (nie obejmuje flasha IGNITE — wtedy można ruszyć). */
	isKickoffDriveLocked(): boolean {
		if (this.countdownHold) return true;
		if (this.postGoalSetupLeft > 0) return true;
		if (this.overtimeBannerLeft > 0) return true;
		return this.getKickoffTick() !== null;
	}

	setCountdownHold(hold: boolean): void {
		this.countdownHold = hold;
	}

	setSkipGoalReplay(skip: boolean): void {
		this.skipGoalReplay = skip;
	}

	isCountdownHeld(): boolean {
		return this.countdownHold;
	}

	/** Odliczanie przed sterowaniem — żeby boty ruszyły w tej samej klatce co GO. */
	advanceCountdown(dt: number): void {
		if (this.countdownHold) return;

		if (this.kickoffIgniteLeft > 0) {
			this.kickoffIgniteLeft = Math.max(0, this.kickoffIgniteLeft - dt);
			if (this.kickoffIgniteLeft <= 0) {
				if (this.phase === "countdown" || this.phase === "goal_pause") {
					if (this.finishAfterGoal) {
						this.phase = "finished";
						this.finishAfterGoal = false;
						this.goalLock = null;
						this.postGoalResetDone = false;
					} else {
						this.phase = "playing";
						this.kickoffWindowLeft = 2.5;
						this.goalLock = null;
						this.postGoalResetDone = false;
					}
				}
			}
			return;
		}

		if (this.phase !== "countdown") return;

		this.countdownLeft -= dt;
		if (this.countdownLeft <= 0) {
			this.countdownLeft = 0;
			this.kickoffIgniteLeft = IGNITE_FLASH_SEC;
		}
	}

	isResetPending(): boolean {
		return (
			this.phase === "goal_pause" ||
			this.phase === "goal_bounce" ||
			this.phase === "goal_replay"
		);
	}

	/** Po teleporcie na kickoff — trzymaj tylną kamerę zanim ruszy odliczanie. */
	isPostGoalCameraSetup(): boolean {
		return (
			this.phase === "goal_pause" &&
			this.postGoalResetDone &&
			this.postGoalSetupLeft > 0
		);
	}

	getResetCountdown(): number | null {
		if (
			this.phase === "goal_pause" &&
			this.postGoalResetDone &&
			this.postGoalSetupLeft <= 0 &&
			this.countdownLeft > 0
		) {
			return this.countdownLeft;
		}
		return null;
	}

	consumeLastGoal(): ScoringTeam | null {
		const t = this.pendingGoalFlash;
		this.pendingGoalFlash = null;
		return t;
	}

	getHudSnapshot(cars: CarEntity[]): MatchHudSnapshot {
		const ffaScores = cars
			.map((c) => ({
				name: c.displayName,
				score: c.individualScore,
				isHuman: c.isHuman,
			}))
			.sort((a, b) => b.score - a.score);

		return {
			phase: this.phase,
			timeRemainingSec: this.timeRemainingSec,
			blueScore: this.blueScore,
			orangeScore: this.orangeScore,
			isFFA: this.isFFA,
			ffaScores,
			goalTeam: this.pendingGoalFlash,
			goalScorerName: this.lastGoalScorerName,
			resetCountdown: this.getResetCountdown(),
			countdownSec:
				this.phase === "countdown" ? Math.max(0, this.countdownLeft) : null,
			kickoffTick: this.getKickoffTick(),
			kickoffIgnite: this.kickoffIgniteLeft > 0,
			overtimeBanner: this.overtimeBannerLeft > 0,
			isOvertime: this.isOvertime,
			winnerLabel: this.phase === "finished" ? this.resolveWinner(cars) : null,
			replayActive: this.phase === "goal_replay",
		};
	}

	private getKickoffTick(): number | null {
		if (this.kickoffIgniteLeft > 0) return null;
		if (this.postGoalSetupLeft > 0) return null;
		if (this.overtimeBannerLeft > 0) return null;
		if (this.phase === "countdown" && this.countdownLeft > 0) {
			return Math.ceil(this.countdownLeft);
		}
		if (
			this.phase === "goal_pause" &&
			this.postGoalResetDone &&
			this.postGoalSetupLeft <= 0 &&
			this.countdownLeft > 0
		) {
			return Math.ceil(this.countdownLeft);
		}
		return null;
	}

	getScores(): { blue: number; orange: number } {
		return { blue: this.blueScore, orange: this.orangeScore };
	}

	getMatchTime(): number {
		return this.matchTime;
	}

	noteBallTouchImpact(slotIndex: number, impact: number, nowSec: number): void {
		this.touchTracker.noteImpact(slotIndex, impact, nowSec);
	}

	consumeGoalMomentSnapshot(): GoalMomentSnapshot | null {
		const snap = this.pendingGoalMoment;
		this.pendingGoalMoment = null;
		return snap;
	}

	private willMatchEndAfterGoal(cars: CarEntity[]): boolean {
		if (this.isOvertime) return true;
		if (this.timeRemainingSec > 0.08) return false;
		if (this.isFFA) return true;
		return !this.isScoreTied(cars);
	}

	private resolveWinner(cars: CarEntity[]): string {
		if (this.isFFA) {
			const top = [...cars].sort(
				(a, b) => b.individualScore - a.individualScore,
			);
			const name = top[0]?.displayName ?? "—";
			return t("match.playerWins", { name });
		}
		return this.blueScore > this.orangeScore
			? t("match.blueWins")
			: t("match.orangeWins");
	}

	private isScoreTied(cars: CarEntity[]): boolean {
		if (this.isFFA) {
			const top = [...cars].sort(
				(a, b) => b.individualScore - a.individualScore,
			);
			const best = top[0]?.individualScore ?? 0;
			return top.filter((c) => c.individualScore === best).length > 1;
		}
		return this.blueScore === this.orangeScore;
	}

	private beginOvertimeFromPlay(ball: GameObject, cars: CarEntity[]): void {
		this.isOvertime = true;
		this.phase = "goal_pause";
		this.goalCelebrationLeft = 0;
		this.postGoalResetDone = false;
		this.pendingOvertimeStart = true;
		this.overtimeBannerLeft = OVERTIME_BANNER_SEC;
		this.countdownLeft = 0;
		this.kickoffIgniteLeft = 0;
		this.goalLock = null;
		this.freezeAllPhysics(cars, ball);
	}

	private beginOvertimeFromPause(ball: GameObject, cars: CarEntity[]): void {
		this.beginOvertimeFromPlay(ball, cars);
	}

	private freezeCarsOnly(cars: CarEntity[]): void {
		for (const car of cars) {
			const body = car.player.rapierRigidBody;
			body.setLinvel({ x: 0, y: 0, z: 0 }, true);
			body.setAngvel({ x: 0, y: 0, z: 0 }, true);
		}
	}

	private freezeAllPhysics(cars: CarEntity[], ball: GameObject): void {
		for (const car of cars) {
			const body = car.player.rapierRigidBody;
			body.setLinvel({ x: 0, y: 0, z: 0 }, true);
			body.setAngvel({ x: 0, y: 0, z: 0 }, true);
		}
		const b = ball.rapierRigidBody;
		b.setLinvel({ x: 0, y: 0, z: 0 }, true);
		b.setAngvel({ x: 0, y: 0, z: 0 }, true);
	}

	private softContainBallInNet(
		ball: GameObject,
		ballRadius: number,
		scored: ScoringTeam,
		dt: number,
	): void {
		const body = ball.rapierRigidBody;
		const pos = ball.getPosition();
		const v = body.linvel();
		const hl = RL_ARENA.HALF_LENGTH;
		const halfW = RL_ARENA.GOAL_WIDTH / 2 - ballRadius * 0.22;
		const lineZ = scored === "blue" ? hl : -hl;
		const backZ =
			scored === "blue"
				? hl + RL_ARENA.GOAL_DEPTH - ballRadius * 0.4
				: -hl - RL_ARENA.GOAL_DEPTH + ballRadius * 0.4;

		const drag = 0.992 ** Math.max(1, dt * 60);
		let vx = v.x * drag;
		const vy = v.y * drag;
		let vz = v.z * drag;

		if (scored === "blue") {
			if (pos.z > backZ && vz > 0) vz = -Math.abs(vz) * 0.62;
			if (pos.z < lineZ - ballRadius * 0.1 && vz < -0.5)
				vz = Math.abs(vz) * 0.28;
		} else {
			if (pos.z < backZ && vz < 0) vz = Math.abs(vz) * 0.62;
			if (pos.z > lineZ + ballRadius * 0.1 && vz > 0.5)
				vz = -Math.abs(vz) * 0.28;
		}

		if (pos.x > halfW) {
			vx = -Math.abs(vx) * 0.48;
			body.setTranslation({ x: halfW, y: pos.y, z: pos.z }, true);
		} else if (pos.x < -halfW) {
			vx = Math.abs(vx) * 0.48;
			body.setTranslation({ x: -halfW, y: pos.y, z: pos.z }, true);
		}

		body.setLinvel({ x: vx, y: vy, z: vz }, true);
	}

	private goalCenter(scored: ScoringTeam): THREE.Vector3 {
		const z =
			scored === "blue"
				? RL_ARENA.HALF_LENGTH + RL_ARENA.GOAL_DEPTH * 0.35
				: -RL_ARENA.HALF_LENGTH - RL_ARENA.GOAL_DEPTH * 0.35;
		return new THREE.Vector3(0, RL_ARENA.GOAL_HEIGHT * 0.45, z);
	}

	private performKickoffReset(
		ball: GameObject,
		cars: CarEntity[],
		carHalfHeight: number,
	): void {
		if (this.spawns.length === 0) {
			this.spawns = buildSpawnPositions(this.mode, carHalfHeight);
		}
		this.touchTracker.reset();

		for (const car of cars) {
			const spawn = this.getSpawn(car.slotIndex);
			car.resetToSpawn(spawn);
		}

		ball.rapierRigidBody.setTranslation({ x: 0, y: 1.0, z: 0 }, true);
		ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		ball.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
	}
}

function buildIgnition1v1Spawns(carHalfHeight: number): CarSpawn[] {
	return buildRlKickoffSpawns("1v1", carHalfHeight).map((spawn) => ({
		...spawn,
		team: null,
		displayName: spawn.slotIndex === 0 ? "You" : "Rival",
	}));
}

function buildIgnitionSpawns(carHalfHeight: number): CarSpawn[] {
	const y = carHalfHeight + 0.12;
	const spawns: CarSpawn[] = [];
	for (let i = 0; i < 8; i++) {
		const angle = (i / 8) * Math.PI * 2 + Math.PI * 0.125;
		const x = Math.sin(angle) * IGNITION_RADIUS;
		const z = Math.cos(angle) * IGNITION_RADIUS;
		const visualTeam: ScoringTeam = i % 2 === 0 ? "blue" : "orange";
		spawns.push({
			slotIndex: i,
			team: null,
			displayName: i === 0 ? "You" : (IGNITION_NAMES[i] ?? `Rival ${i + 1}`),
			position: new THREE.Vector3(x, y, z),
			yaw: angle + Math.PI,
			visualTeam,
			spawnRole: "offensive_corner",
		});
	}
	return spawns;
}

function buildTeamSpawns(mode: GameModeId, carHalfHeight: number): CarSpawn[] {
	return buildRlKickoffSpawns(mode, carHalfHeight);
}

export type GoalMomentSnapshot = {
	scoringTeam: ScoringTeam;
	touch: GoalTouchContext;
	isOvertime: boolean;
	isGoldenGoal: boolean;
	isKickoffWindow: boolean;
	timeRemainingSec: number;
	matchEndsAfterGoal: boolean;
};
