import * as THREE from "three";

import type { ScoringTeam } from "../../game/modes";
import type Player from "../../util/Player";
import { RL_CAR } from "../../util/rlConstants";
import { RL_ARENA } from "../../visual/arenaConstants";
import type { BotRole } from "../AIManager";
import type { JumpHintContext } from "./BotJumpResolver";
import { POLICY_INPUT_SIZE } from "./BotPolicy";

const GOAL_BLUE = new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH);
const GOAL_ORANGE = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);
const ARENA_SCALE = Math.hypot(RL_ARENA.HALF_WIDTH, RL_ARENA.HALF_LENGTH);

const _rel = new THREE.Vector3();
const _enemyGoal = new THREE.Vector3();
const _goalDir = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export type ObservationContext = {
	ballPos: THREE.Vector3;
	ballVel: THREE.Vector3;
	team: ScoringTeam | null;
	role: BotRole;
	isFFA: boolean;
};

export type BotThinkContext = ObservationContext & {
	heuristicJump: boolean;
	forceRecovery: boolean;
	forcedJump: boolean;
	defending: boolean;
	clearanceActive: boolean;
};

export function jumpHintFromThinkContext(
	ctx: BotThinkContext,
): JumpHintContext {
	return {
		ballPos: ctx.ballPos,
		ballVel: ctx.ballVel,
		heuristicJump: ctx.heuristicJump,
		forceRecovery: ctx.forceRecovery,
		forcedJump: ctx.forcedJump,
		defending: ctx.defending,
		clearanceActive: ctx.clearanceActive,
		goalie: ctx.role === "goalie",
	};
}

export function enemyGoalFor(
	team: ScoringTeam | null,
	ballPos: THREE.Vector3,
	isFFA: boolean,
): THREE.Vector3 {
	if (isFFA || !team) {
		return ballPos.distanceToSquared(GOAL_BLUE) <
			ballPos.distanceToSquared(GOAL_ORANGE)
			? GOAL_BLUE
			: GOAL_ORANGE;
	}
	return team === "blue" ? GOAL_BLUE : GOAL_ORANGE;
}

export function buildBotObservation(
	player: Player,
	ctx: ObservationContext,
	out = new Float32Array(POLICY_INPUT_SIZE),
): Float32Array {
	const pos = player.getPosition();
	const vel = player.getVelocity();

	_rel.subVectors(ctx.ballPos, pos);
	out[0] = THREE.MathUtils.clamp(_rel.x / ARENA_SCALE, -1, 1);
	out[1] = THREE.MathUtils.clamp(_rel.z / ARENA_SCALE, -1, 1);
	out[2] = THREE.MathUtils.clamp(_rel.y / 5, -1, 1);

	out[3] = THREE.MathUtils.clamp(ctx.ballVel.x / RL_CAR.maxSpeed, -1, 1);
	out[4] = THREE.MathUtils.clamp(ctx.ballVel.z / RL_CAR.maxSpeed, -1, 1);

	_enemyGoal.copy(enemyGoalFor(ctx.team, ctx.ballPos, ctx.isFFA));
	_goalDir.subVectors(_enemyGoal, pos);
	_goalDir.y = 0;
	if (_goalDir.lengthSq() > 1e-4) _goalDir.normalize();
	out[5] = _goalDir.x;
	out[6] = _goalDir.z;

	_fwd.copy(player.getForward());
	_fwd.y = 0;
	if (_fwd.lengthSq() > 1e-4) _fwd.normalize();
	out[7] = _fwd.x;
	out[8] = _fwd.z;

	out[9] = THREE.MathUtils.clamp(vel.length() / RL_CAR.maxSpeed, 0, 1);
	out[10] = player.getBoostFuel();
	out[11] = player.isOnGround() ? 1 : 0;
	out[12] = THREE.MathUtils.clamp(
		pos.distanceTo(ctx.ballPos) / ARENA_SCALE,
		0,
		1,
	);

	out[13] = ctx.role === "striker" ? 1 : 0;
	out[14] = ctx.role === "support" ? 1 : 0;
	out[15] = ctx.role === "goalie" ? 1 : 0;
	out[16] = THREE.MathUtils.clamp(ctx.ballPos.y / 5, 0, 1);

	const dist = _rel.length();
	if (dist > 1e-4) {
		out[17] = THREE.MathUtils.clamp(
			_fwd.dot(_rel.multiplyScalar(1 / dist)),
			-1,
			1,
		);
	} else {
		out[17] = 1;
	}

	out[18] = THREE.MathUtils.clamp(player.getUpward().y, -1, 1);
	out[19] = THREE.MathUtils.clamp(player.getWheelsGroundedCount() / 4, 0, 1);
	out[20] = player.getUpward().y < -0.2 ? 1 : 0;

	return out;
}
