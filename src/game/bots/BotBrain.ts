import * as THREE from "three";
import type Player from "../../util/Player";
import { RL_ARENA } from "../../visual/arenaConstants";
import type { ScoringTeam } from "../modes";
import { type BotDrive, steerToward } from "./steering";

export type BotPeer = {
	slotIndex: number;
	team: ScoringTeam | null;
	position: THREE.Vector3;
};

export type BotContext = {
	ballPos: THREE.Vector3;
	ballVel: THREE.Vector3;
	kickoffActive: boolean;
	carsFrozen: boolean;
	isFFA: boolean;
	teamSize: number;
	peers: BotPeer[];
};

const GOAL_BLUE = new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH);
const GOAL_ORANGE = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);

const _target = new THREE.Vector3();
const _predicted = new THREE.Vector3();
const _shotLine = new THREE.Vector3();
const _offset = new THREE.Vector3();

export class BotBrain {
	private kickoffDelay = 0;
	private jumpCooldown = 0;

	constructor(
		readonly team: ScoringTeam | null,
		readonly slotIndex: number,
		private readonly ignitionAggro = false,
	) {}

	resetKickoff(): void {
		this.kickoffDelay = this.slotIndex * 0.12;
	}

	think(player: Player, ctx: BotContext, dt: number): BotDrive {
		this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
		this.kickoffDelay = Math.max(0, this.kickoffDelay - dt);

		if (ctx.carsFrozen) {
			return { forward: 0, yaw: 0, boost: false };
		}

		const pos = player.getPosition();
		const ball = ctx.ballPos;

		if (this.isUpsideDown(player)) {
			return { forward: 1, yaw: 0, boost: false, jump: true };
		}

		const distBall = pos.distanceTo(ball);

		this.predictBall(ctx, 0.35, _predicted);

		if (ctx.kickoffActive || this.kickoffDelay > 0) {
			if (this.kickoffDelay > 0.05) {
				return { forward: 0, yaw: 0, boost: false };
			}
			return steerToward(_predicted, player, {
				boost: distBall > 6,
				arriveRadius: 1.2,
			});
		}

		const role = this.fieldRole(pos, ctx);

		if (role === "attack" || distBall < 14) {
			const attackGoal = this.attackGoalFor(ctx);
			_shotLine.copy(attackGoal).sub(ball);
			if (_shotLine.lengthSq() > 0.01) {
				_shotLine.normalize();
				_target.copy(ball).addScaledVector(_shotLine, 2.2);
			} else {
				_target.copy(ball);
			}
		} else if (role === "defend") {
			const attackGoal = this.attackGoalFor(ctx);
			_target.copy(ball).add(attackGoal).multiplyScalar(0.5);
			this.applySpread(_target, ball, attackGoal, ctx);
		} else {
			const attackGoal = this.attackGoalFor(ctx);
			_target.copy(_predicted);
			this.applySpread(_target, ball, attackGoal, ctx);
		}

		const wantBoost =
			distBall > 6 &&
			(role === "attack" ||
				role === "chase" ||
				(ctx.isFFA && this.ignitionAggro));

		const drive = steerToward(_target, player, {
			boost: wantBoost,
			arriveRadius: role === "attack" ? 1.6 : 2.8,
			reverseOk: distBall > 20,
		});

		return this.maybeJump(drive, ball, pos, distBall);
	}

	private fieldRole(
		pos: THREE.Vector3,
		ctx: BotContext,
	): "attack" | "chase" | "defend" {
		const ball = ctx.ballPos;
		const distBall = pos.distanceTo(ball);
		const defendGoal = this.defendGoalFor(ctx);

		if (distBall < 11) return "attack";

		const ballNearOurGoal =
			ball.distanceTo(defendGoal) < RL_ARENA.HALF_LENGTH * 0.38;
		if (ballNearOurGoal && !ctx.isFFA && this.team) {
			const iAmClosest = this.amClosestTeammate(pos, ctx);
			if (iAmClosest || distBall < 28) return "defend";
		}

		if (this.amClosestTeammate(pos, ctx) || ctx.isFFA) return "chase";
		return "chase";
	}

	private applySpread(
		target: THREE.Vector3,
		ball: THREE.Vector3,
		attackGoal: THREE.Vector3,
		_ctx: BotContext,
	): void {
		_shotLine.copy(attackGoal).sub(ball);
		_shotLine.y = 0;
		if (_shotLine.lengthSq() < 0.01) return;
		_shotLine.normalize();

		const lane = (this.slotIndex % 3) - 1;
		_offset.set(-_shotLine.z, 0, _shotLine.x).multiplyScalar(lane * 5);
		target.add(_offset);
	}

	private predictBall(
		ctx: BotContext,
		leadSec: number,
		out: THREE.Vector3,
	): void {
		out.copy(ctx.ballPos).addScaledVector(ctx.ballVel, leadSec);
		out.y = ctx.ballPos.y;
	}

	private amClosestTeammate(pos: THREE.Vector3, ctx: BotContext): boolean {
		if (ctx.isFFA || !this.team) return true;

		const myDist = pos.distanceTo(ctx.ballPos);
		for (const peer of ctx.peers) {
			if (peer.team !== this.team || peer.slotIndex === this.slotIndex)
				continue;
			if (peer.position.distanceTo(ctx.ballPos) < myDist - 1.5) return false;
		}
		return true;
	}

	private attackGoalFor(ctx: BotContext): THREE.Vector3 {
		if (ctx.isFFA || !this.team) {
			const toBlue = ctx.ballPos.distanceToSquared(GOAL_BLUE);
			const toOrange = ctx.ballPos.distanceToSquared(GOAL_ORANGE);
			return toBlue < toOrange ? GOAL_BLUE : GOAL_ORANGE;
		}
		return this.team === "blue" ? GOAL_BLUE : GOAL_ORANGE;
	}

	private defendGoalFor(_ctx: BotContext): THREE.Vector3 {
		if (this.team === "blue") return GOAL_ORANGE;
		if (this.team === "orange") return GOAL_BLUE;
		return GOAL_ORANGE;
	}

	private isUpsideDown(player: Player): boolean {
		return player.getUpward().y < 0.15;
	}

	private maybeJump(
		drive: BotDrive,
		ball: THREE.Vector3,
		pos: THREE.Vector3,
		dist: number,
	): BotDrive {
		if (this.jumpCooldown > 0) return drive;
		if (ball.y > pos.y + 1.2 && dist < 5) {
			this.jumpCooldown = 0.9;
			return { ...drive, jump: true };
		}
		return drive;
	}
}
