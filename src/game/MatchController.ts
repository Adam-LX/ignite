import * as THREE from "three";

import type GameObject from "../GameObject";
import type Player from "../util/Player";
import {
	detectGoalScored,
	getStadiumLeds,
	spawnKickoff,
} from "../visual/arena";
import { RL_ARENA } from "../visual/arenaConstants";
import { GoalVfx } from "../visual/vfx/goalVfx";

const RESET_DELAY_SEC = 3;

export type ScoringTeam = "blue" | "orange";

export class MatchController {
	private readonly goalVfx: GoalVfx;
	private readonly playerTeam: ScoringTeam = "blue";

	private goalLock: ScoringTeam | null = null;
	private resetTimer = 0;
	private pendingReset = false;
	private blueScore = 0;
	private orangeScore = 0;
	private lastScoringTeam: ScoringTeam | null = null;

	constructor(scene: THREE.Scene) {
		this.goalVfx = new GoalVfx(scene);
	}

	update(
		dt: number,
		ball: GameObject,
		player: Player,
		ballRadius: number,
		carHalfHeight: number,
	): ScoringTeam | null {
		this.goalVfx.update(dt);

		if (this.pendingReset) {
			this.softContainBallInNet(
				ball,
				ballRadius,
				this.goalLock ?? this.lastScoringTeam ?? "blue",
			);
			this.resetTimer -= dt;
			if (this.resetTimer <= 0) {
				this.performKickoffReset(ball, player, carHalfHeight);
				this.pendingReset = false;
				this.goalLock = null;
			}
			return null;
		}

		const scored = detectGoalScored(ball.getPosition(), ballRadius);
		if (!scored || scored === this.goalLock) {
			if (!scored) this.goalLock = null;
			return null;
		}

		this.goalLock = scored;
		this.pendingReset = true;
		this.resetTimer = RESET_DELAY_SEC;
		this.lastScoringTeam = scored;
		if (scored === "blue") this.blueScore++;
		else this.orangeScore++;

		getStadiumLeds()?.onGoal(scored);

		const goalPos = this.goalCenter(scored);
		this.goalVfx.trigger(goalPos, scored);
		this.applyGoalRepulse(player, scored, goalPos);

		return scored;
	}

	isResetPending(): boolean {
		return this.pendingReset;
	}

	getScores(): { blue: number; orange: number } {
		return { blue: this.blueScore, orange: this.orangeScore };
	}

	getResetCountdown(): number | null {
		return this.pendingReset ? this.resetTimer : null;
	}

	consumeLastGoal(): ScoringTeam | null {
		const t = this.lastScoringTeam;
		this.lastScoringTeam = null;
		return t;
	}

	/** Delikatne tłumienie w siatce — piłka wpada płynnie, nie wypada przed kickoff. */
	private softContainBallInNet(
		ball: GameObject,
		ballRadius: number,
		scored: ScoringTeam,
	): void {
		const body = ball.rapierRigidBody;
		const pos = ball.getPosition();
		const v = body.linvel();
		const hl = RL_ARENA.HALF_LENGTH;
		const halfW = RL_ARENA.GOAL_WIDTH / 2 - ballRadius * 0.18;
		const lineZ = scored === "blue" ? hl : -hl;
		const backZ =
			scored === "blue"
				? hl + RL_ARENA.GOAL_DEPTH - ballRadius * 0.35
				: -hl - RL_ARENA.GOAL_DEPTH + ballRadius * 0.35;

		const drag = 0.985;
		let vx = v.x * drag;
		const vy = v.y * drag;
		let vz = v.z * drag;

		if (scored === "blue") {
			if (pos.z < lineZ + ballRadius * 0.25 && vz < 0) vz = Math.abs(vz) * 0.12;
			if (pos.z > backZ && vz > 0) vz = -Math.abs(vz) * 0.25;
		} else {
			if (pos.z > lineZ - ballRadius * 0.25 && vz > 0)
				vz = -Math.abs(vz) * 0.12;
			if (pos.z < backZ && vz < 0) vz = Math.abs(vz) * 0.25;
		}

		if (pos.x > halfW && vx > 0) vx = -Math.abs(vx) * 0.2;
		if (pos.x < -halfW && vx < 0) vx = Math.abs(vx) * 0.2;

		body.setLinvel({ x: vx, y: vy, z: vz }, true);
	}

	private goalCenter(scored: ScoringTeam): THREE.Vector3 {
		const z =
			scored === "blue"
				? RL_ARENA.HALF_LENGTH + RL_ARENA.GOAL_DEPTH * 0.35
				: -RL_ARENA.HALF_LENGTH - RL_ARENA.GOAL_DEPTH * 0.35;
		return new THREE.Vector3(0, RL_ARENA.GOAL_HEIGHT * 0.45, z);
	}

	private applyGoalRepulse(
		player: Player,
		scored: ScoringTeam,
		goalPos: THREE.Vector3,
	): void {
		const carPos = player.getPosition();
		const push = carPos.clone().sub(goalPos);
		if (push.lengthSq() < 0.01) {
			push.set(0, 0, scored === "blue" ? -1 : 1);
		}
		push.normalize();

		const ix = push.x * 9;
		const iy = 5;
		const iz = push.z * 9;
		if (!Number.isFinite(ix + iy + iz)) return;

		player.rapierRigidBody.applyImpulse({ x: ix, y: iy, z: iz }, true);
	}

	private performKickoffReset(
		ball: GameObject,
		player: Player,
		carHalfHeight: number,
	): void {
		const spawn = spawnKickoff(this.playerTeam, carHalfHeight);
		player.rapierRigidBody.setTranslation(
			{ x: spawn.x, y: spawn.y, z: spawn.z },
			true,
		);
		player.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		player.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

		ball.rapierRigidBody.setTranslation({ x: 0, y: 1.0, z: 0 }, true);
		ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		ball.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
	}
}
