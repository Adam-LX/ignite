import * as THREE from "three";
import type { ScoringTeam } from "../game/modes";
import type { IgnitionManager } from "../modes/IgnitionManager";
import type Player from "../util/Player";
import { RL_CAR } from "../util/rlConstants";
import {
	createEmptySimulatedInput,
	type SimulatedInput,
} from "../util/SimulatedInput";
import { RL_ARENA } from "../visual/arenaConstants";
import type { BotRole } from "./AIManager";
import {
	ballThreatensOwnGoal,
	isBallAirborne,
	isBallIdle,
	isBehindBall,
	isLooseBall,
	shouldJumpForBall,
	shouldRepositionAroundBall,
} from "./botTactics";
import { BotLearning } from "./learning/BotLearning";
import type { BotLearningTuning } from "./learning/BotLearningTuning";

export type { SimulatedInput } from "../util/SimulatedInput";

export type BotFsmState = "ALIGN_SHOT" | "REPOSITION" | "RECOVERY" | "AERIAL";

export type BotDrive = {
	forward: number;
	yaw: number;
	boost: boolean;
	jump?: boolean;
};

export type BotPeer = {
	slotIndex: number;
	team: ScoringTeam | null;
	position: THREE.Vector3;
	isHuman: boolean;
};

export type BehaviorContext = {
	ballPos: THREE.Vector3;
	ballVel: THREE.Vector3;
	intercept: THREE.Vector3;
	kickoffActive: boolean;
	kickoffCountdown: boolean;
	kickoffDriveLocked: boolean;
	carsFrozen: boolean;
	isFFA: boolean;
	teamSize: number;
	peers: BotPeer[];
};

const GOAL_BLUE = new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH);
const GOAL_ORANGE = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);
const ARENA_CENTER = new THREE.Vector3(0, 0, 0);

const WALL_ESCAPE_MARGIN = 4;
const WALL_X_THRESHOLD = RL_ARENA.HALF_WIDTH - WALL_ESCAPE_MARGIN;
const WALL_Z_THRESHOLD = RL_ARENA.HALF_LENGTH - WALL_ESCAPE_MARGIN;
const WALL_REVERSE_FRAMES = 8;
const TURTLE_UP_THRESHOLD = -0.2;
const STEER_YAW_GAIN = 2.35;
const STEER_DEADZONE = 0.055;
const TARGET_SMOOTH_LAMBDA = 8.5;
const DRIVE_FWD_DAMP = 11;
const DRIVE_YAW_DAMP = 13;
const BOOST_ALIGN_TOLERANCE = 0.15;
const BOOST_MIN_DIST = 10;
const DODGE_BALL_MAX_DIST = 5.0;
const DODGE_ALIGN_TOLERANCE = 0.2;
const DODGE_COOLDOWN_SEC = 2.4;

const _fwd = new THREE.Vector3();
const _targetDir = new THREE.Vector3();
const _target = new THREE.Vector3();
const _shotLine = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _goalDir = new THREE.Vector3();
const _botToBall = new THREE.Vector3();
const _toCenter = new THREE.Vector3();

export function computeIntercept(
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	botPos: THREE.Vector3,
	maxSpeed = RL_CAR.maxSpeed as number,
	out = new THREE.Vector3(),
): THREE.Vector3 {
	const dist = botPos.distanceTo(ballPos);
	const tArrival = dist / Math.max(maxSpeed, 4);
	out.copy(ballPos).addScaledVector(ballVel, tArrival);
	out.y = ballPos.y;
	return out;
}

/** Kompatybilność wsteczna — deleguje do poprawionej matematyki cross/dot. */
export function vectorSteer(
	target: THREE.Vector3,
	player: Player,
	opts?: { arriveRadius?: number; reverseOk?: boolean; maxYaw?: number },
): { forward: number; yaw: number; left: number; right: number } {
	const input = createEmptySimulatedInput();
	applyVectorSteering(input, target, player);
	const drive = simulatedToDrive(input);
	const left = input.left ? (opts?.maxYaw ?? 1) : 0;
	const right = input.right ? (opts?.maxYaw ?? 1) : 0;
	if (opts?.arriveRadius) {
		const dist = player.getPosition().distanceTo(target);
		if (dist < opts.arriveRadius && drive.forward > 0) {
			return {
				forward: 0.8,
				yaw: drive.yaw * 0.6,
				left: left * 0.6,
				right: right * 0.6,
			};
		}
	}
	return { forward: drive.forward, yaw: drive.yaw, left, right };
}

function simulatedToDrive(input: SimulatedInput): BotDrive {
	if (input.forwardAxis !== undefined) {
		return {
			forward: input.forwardAxis,
			yaw: input.yawAxis ?? 0,
			boost: input.boost,
			jump: input.jump,
		};
	}

	let forward = 0;
	if (input.forward) forward = 1;
	else if (input.backward) forward = -1;

	let yaw = 0;
	if (input.left && !input.right) yaw = 1;
	else if (input.right && !input.left) yaw = -1;

	return {
		forward,
		yaw,
		boost: input.boost,
		jump: input.jump,
	};
}

function syncBooleansFromAxes(input: SimulatedInput): void {
	const forward = input.forwardAxis ?? 0;
	const yaw = input.yawAxis ?? 0;
	input.forward = forward > 0.12;
	input.backward = forward < -0.12;
	input.left = yaw > 0.12;
	input.right = yaw < -0.12;
}

/** Proporcjonalny skręt — zamiast pełnego A/D przy każdym progu. */
export function computeAnalogSteer(
	targetPos: THREE.Vector3,
	player: Player,
): { forward: number; yaw: number; crossY: number } {
	const botPos = player.getPosition();

	_fwd.copy(player.getForward());
	_fwd.y = 0;
	if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
	_fwd.normalize();

	_targetDir.subVectors(targetPos, botPos);
	_targetDir.y = 0;
	const dist = _targetDir.length();
	if (dist < 0.05) return { forward: 0, yaw: 0, crossY: 0 };
	_targetDir.normalize();

	const dot = _fwd.dot(_targetDir);
	const crossY = _fwd.z * _targetDir.x - _fwd.x * _targetDir.z;

	if (!player.isOnGround()) {
		let yaw = THREE.MathUtils.clamp(crossY * 1.85, -1, 1);
		if (Math.abs(yaw) < STEER_DEADZONE) yaw = 0;
		const forward =
			dot > -0.15 ? THREE.MathUtils.clamp(0.38 + dot * 0.58, 0.32, 1) : 0;
		return { forward, yaw, crossY };
	}

	let yaw = THREE.MathUtils.clamp(crossY * STEER_YAW_GAIN, -1, 1);
	if (Math.abs(yaw) < STEER_DEADZONE) yaw = 0;

	let forward = 0;
	if (dot > -0.35) {
		forward = THREE.MathUtils.clamp(0.22 + dot * 0.88, 0.38, 1);
		forward *= 1 - Math.min(0.38, Math.abs(crossY) * 0.42);
	} else if (dot < -0.45 && dist > 3.5) {
		forward = -THREE.MathUtils.clamp(0.4 + -dot * 0.48, 0.42, 0.92);
	}

	return { forward, yaw, crossY };
}

function applyVectorSteering(
	input: SimulatedInput,
	targetPos: THREE.Vector3,
	player: Player,
): number {
	const steer = computeAnalogSteer(targetPos, player);
	input.forwardAxis = steer.forward;
	input.yawAxis = steer.yaw;
	syncBooleansFromAxes(input);
	return steer.crossY;
}

export class BotBehavior {
	private fsmState: BotFsmState = "ALIGN_SHOT";
	private simulatedInput: SimulatedInput = createEmptySimulatedInput();
	private kickoffDelay = 0;
	private jumpCooldown = 0;
	private dodgeCooldown = 0;
	private clearanceActive = false;
	private spikesRush = false;
	private frontFlipPhase: "none" | "first" | "flip" = "none";
	private lastCrossY = 0;
	private lastTargetDist = 0;
	private triggerDodgeSequence = false;
	private dodgePhase: "none" | "jump1" | "gap" | "flip" = "none";
	private dodgeFramesLeft = 0;
	private wallReverseFramesLeft = 0;
	private readonly smoothedTarget = new THREE.Vector3();
	private smoothDriveFwd = 0;
	private smoothDriveYaw = 0;
	private hasSmoothedTarget = false;
	private chasingLooseBall = false;
	private heuristicJumpRequest = false;
	private forceRecoveryJump = false;
	private forcedJumpFrames = 0;

	constructor(
		readonly team: ScoringTeam | null,
		readonly slotIndex: number,
	) {}

	resetKickoff(): void {
		this.kickoffDelay = this.slotIndex * 0.05;
		this.fsmState = "ALIGN_SHOT";
		this.clearanceActive = false;
		this.spikesRush = false;
		this.frontFlipPhase = "none";
		this.triggerDodgeSequence = false;
		this.dodgePhase = "none";
		this.dodgeFramesLeft = 0;
		this.dodgeCooldown = 0;
		this.wallReverseFramesLeft = 0;
		this.hasSmoothedTarget = false;
		this.smoothDriveFwd = 0;
		this.smoothDriveYaw = 0;
	}

	getFsmState(): BotFsmState {
		return this.fsmState;
	}

	setFsmState(state: BotFsmState): void {
		this.fsmState = state;
	}

	forceSpikesRush(): void {
		this.spikesRush = true;
		this.fsmState = "ALIGN_SHOT";
	}

	think(
		player: Player,
		role: BotRole,
		ctx: BehaviorContext,
		ignition: IgnitionManager | null,
		dt: number,
	): BotDrive {
		this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
		this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
		this.kickoffDelay = Math.max(0, this.kickoffDelay - dt);

		const tuning = BotLearning.get().getTuning(this.slotIndex);

		this.simulatedInput = createEmptySimulatedInput();
		this.heuristicJumpRequest = false;
		this.forceRecoveryJump = false;
		this.chasingLooseBall = isLooseBall(ctx.ballVel) && !ctx.carsFrozen;

		if (ctx.carsFrozen) {
			player.updateInputs(this.simulatedInput, dt);
			return { forward: 0, yaw: 0, boost: false };
		}

		const pos = player.getPosition();
		const enemyGoal = this.attackGoal(ctx);
		const ownGoal = this.defendGoal();

		// Etap 1 — turtle recovery: tylko PPM/recover, zero WASD
		if (player.getUpward().y < TURTLE_UP_THRESHOLD) {
			this.forceRecoveryJump = true;
			this.fsmState = "RECOVERY";
			return this.finishThink(player, role, ctx, ignition, dt, ownGoal);
		}

		if (this.spikesRush) {
			this.fsmState = "ALIGN_SHOT";
			this.pickTarget(
				_target,
				"ALIGN_SHOT",
				role,
				ctx,
				pos,
				enemyGoal,
				ownGoal,
				tuning,
			);
			this.lastCrossY = this.steerTowardTarget(_target, player);
			this.applyBoost(
				this.simulatedInput,
				player,
				this.lastCrossY,
				this.lastTargetDist,
				tuning,
			);
			if (pos.distanceTo(enemyGoal) < 8) this.spikesRush = false;
			return this.finishThink(player, role, ctx, ignition, dt, ownGoal);
		}

		this.updateClearance(role, ctx, ownGoal);

		if (ctx.kickoffActive || this.kickoffDelay > 0) {
			if (role === "goalie" && !ctx.isFFA && !isLooseBall(ctx.ballVel)) {
				this.fsmState = "REPOSITION";
				this.defensiveAnchor(_target, ownGoal);
			} else {
				this.fsmState = "ALIGN_SHOT";
				_target.copy(ctx.ballPos);
				if (role === "support" && ctx.teamSize >= 3) {
					_offset.set(this.slotIndex % 2 === 0 ? 3.5 : -3.5, 0, 0);
					_target.add(_offset);
				}
			}
		} else {
			this.fsmState = this.evaluateFsm(
				player,
				role,
				ctx,
				pos,
				enemyGoal,
				tuning,
			);
			const defendingHigh = ballThreatensOwnGoal(
				ctx.ballPos,
				ctx.ballVel,
				ownGoal,
			);
			const aerialMinY = 1.75 - tuning.aerialBias * 0.4;
			if (
				isBallAirborne(ctx.ballPos, ctx.ballVel, aerialMinY) &&
				(role !== "goalie" || defendingHigh)
			) {
				this.fsmState = "AERIAL";
			}
			this.pickTarget(
				_target,
				this.fsmState,
				role,
				ctx,
				pos,
				enemyGoal,
				ownGoal,
				tuning,
			);
		}

		this.applyWallAvoidance(_target, pos, player);

		this.applyPeerSpread(_target, ctx, pos);

		this.smoothSteerTarget(
			_target,
			dt,
			ctx.kickoffActive || this.kickoffDelay > 0,
		);

		this.lastTargetDist = pos.distanceTo(this.smoothedTarget);
		this.lastCrossY = this.steerTowardTarget(this.smoothedTarget, player);

		if (this.wallReverseFramesLeft > 0) {
			this.wallReverseFramesLeft--;
			this.simulatedInput.forwardAxis = -0.88;
			this.simulatedInput.yawAxis = 0;
			this.smoothDriveFwd = -0.88;
			this.smoothDriveYaw = 0;
			syncBooleansFromAxes(this.simulatedInput);
			this.simulatedInput.boost = false;
		}

		if (this.dodgePhase === "none") {
			this.tryStartDodge(
				player,
				role,
				pos,
				ctx.ballPos,
				ctx.ballVel,
				ownGoal,
				this.lastCrossY,
			);
		}

		if (this.dodgePhase !== "none") {
			this.applyDodgeSequence(this.simulatedInput);
		} else if (this.fsmState === "AERIAL") {
			this.applyAerialControl(
				this.simulatedInput,
				player,
				ctx,
				ownGoal,
				tuning,
			);
		} else if (this.fsmState === "RECOVERY") {
			if (player.getUpward().y < 0.2 || player.getSurfaceNormal().y < 0.5) {
				this.forceRecoveryJump = true;
			}
		} else {
			const aerialLaunched = this.applyAerialTakeoff(
				this.simulatedInput,
				player,
				ctx,
				pos,
				ownGoal,
				role,
				tuning,
			);
			if (!aerialLaunched) {
				this.applyFrontFlip(player, role, ctx, pos, ownGoal);
				this.applyJump(
					player,
					role,
					ctx.ballPos,
					ctx.ballVel,
					pos,
					enemyGoal,
					ownGoal,
				);
			}
		}

		this.applyBoost(
			this.simulatedInput,
			player,
			this.lastCrossY,
			this.lastTargetDist,
			tuning,
		);

		return this.finishThink(player, role, ctx, ignition, dt, ownGoal);
	}

	private requestHeuristicJump(): void {
		if (this.jumpCooldown > 0) return;
		this.heuristicJumpRequest = true;
	}

	private armForcedJump(frames = 2): void {
		this.forcedJumpFrames = Math.max(this.forcedJumpFrames, frames);
	}

	private finishThink(
		player: Player,
		role: BotRole,
		ctx: BehaviorContext,
		ignition: IgnitionManager | null,
		dt: number,
		ownGoal: THREE.Vector3,
	): BotDrive {
		const defending = ballThreatensOwnGoal(ctx.ballPos, ctx.ballVel, ownGoal);
		const driveBase = simulatedToDrive(this.simulatedInput);
		driveBase.jump = false;

		const drive = BotLearning.get().think(
			this.slotIndex,
			player,
			role,
			{
				ballPos: ctx.ballPos,
				ballVel: ctx.ballVel,
				team: this.team,
				role,
				isFFA: ctx.isFFA,
				heuristicJump: this.heuristicJumpRequest,
				forceRecovery: this.forceRecoveryJump,
				forcedJump: this.forcedJumpFrames > 0,
				defending,
				clearanceActive: this.clearanceActive,
			},
			driveBase,
		);

		if (drive.jump) {
			if (this.forcedJumpFrames > 0) this.forcedJumpFrames--;
			this.jumpCooldown = 0.85;
		}

		this.applyDriveToSimulated(drive, dt);
		player.updateInputs(this.simulatedInput, dt);
		return this.applyIgnition(drive, player, role, ctx, ignition);
	}

	private smoothSteerTarget(
		target: THREE.Vector3,
		dt: number,
		snap: boolean,
	): void {
		if (snap || !this.hasSmoothedTarget) {
			this.smoothedTarget.copy(target);
			this.hasSmoothedTarget = true;
			return;
		}
		const lambda = TARGET_SMOOTH_LAMBDA;
		const t = 1 - Math.exp(-lambda * Math.max(dt, 1 / 240));
		this.smoothedTarget.x = THREE.MathUtils.lerp(
			this.smoothedTarget.x,
			target.x,
			t,
		);
		this.smoothedTarget.z = THREE.MathUtils.lerp(
			this.smoothedTarget.z,
			target.z,
			t,
		);
		// Piłka spadła — nie goni wygaszonego celu pod sufit
		const yRate =
			target.y < this.smoothedTarget.y - 0.3 ? Math.min(1, t * 6) : t;
		this.smoothedTarget.y = THREE.MathUtils.lerp(
			this.smoothedTarget.y,
			target.y,
			yRate,
		);
	}

	private applyDriveToSimulated(drive: BotDrive, dt: number): void {
		this.smoothDriveFwd = THREE.MathUtils.damp(
			this.smoothDriveFwd,
			drive.forward,
			DRIVE_FWD_DAMP,
			dt,
		);
		this.smoothDriveYaw = THREE.MathUtils.damp(
			this.smoothDriveYaw,
			drive.yaw,
			DRIVE_YAW_DAMP,
			dt,
		);

		const fwd = Math.abs(this.smoothDriveFwd) < 0.03 ? 0 : this.smoothDriveFwd;
		const yaw = Math.abs(this.smoothDriveYaw) < 0.03 ? 0 : this.smoothDriveYaw;

		this.simulatedInput.forwardAxis = fwd;
		this.simulatedInput.yawAxis = yaw;
		syncBooleansFromAxes(this.simulatedInput);
		this.simulatedInput.boost = drive.boost;
		this.simulatedInput.jump = drive.jump === true;
	}

	private tryStartDodge(
		player: Player,
		role: BotRole,
		pos: THREE.Vector3,
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		ownGoal: THREE.Vector3,
		crossY: number,
	): void {
		if (role !== "striker") return;
		if (this.triggerDodgeSequence || this.dodgePhase !== "none") return;
		if (this.dodgeCooldown > 0) return;
		if (isLooseBall(ballVel)) return;
		if (ballThreatensOwnGoal(ballPos, ballVel, ownGoal, 0.8)) return;

		const aerialDodge = isBallAirborne(ballPos, ballVel, 1.75);
		const powerShotDodge =
			ballVel.length() > 10 && ballPos.y > 1.15 && ballPos.y < 4.5;
		if (!aerialDodge && !powerShotDodge) return;

		const distanceToBall = pos.distanceTo(ballPos);
		if (
			distanceToBall < DODGE_BALL_MAX_DIST &&
			Math.abs(crossY) < DODGE_ALIGN_TOLERANCE &&
			player.isOnGround()
		) {
			this.triggerDodgeSequence = true;
			this.dodgePhase = "jump1";
			this.dodgeFramesLeft = 2;
		}
	}

	private applyDodgeSequence(input: SimulatedInput): void {
		if (this.dodgePhase === "jump1") {
			this.armForcedJump();
			this.dodgeFramesLeft--;
			if (this.dodgeFramesLeft <= 0) {
				this.dodgePhase = "gap";
				this.dodgeFramesLeft = 1;
			}
			return;
		}

		if (this.dodgePhase === "gap") {
			this.dodgeFramesLeft--;
			if (this.dodgeFramesLeft <= 0) {
				this.dodgePhase = "flip";
			}
			return;
		}

		if (this.dodgePhase === "flip") {
			this.armForcedJump();
			input.forward = true;
			input.forwardAxis = 1;
			this.dodgePhase = "none";
			this.triggerDodgeSequence = false;
			this.dodgeCooldown = DODGE_COOLDOWN_SEC;
		}
	}

	private evaluateFsm(
		player: Player,
		role: BotRole,
		ctx: BehaviorContext,
		pos: THREE.Vector3,
		enemyGoal: THREE.Vector3,
		tuning: BotLearningTuning,
	): BotFsmState {
		const surfaceY = player.getSurfaceNormal().y;
		if (surfaceY < 0.5 || player.getUpward().y < 0.15) {
			return "RECOVERY";
		}

		if (player.isOnWallOrRamp() && pos.y < 6) {
			return "RECOVERY";
		}

		const distBall = pos.distanceTo(ctx.ballPos);
		const engage = 20 * tuning.challengeRadiusMul;
		const press = 24 * tuning.aggression;
		const defenseMul = 1 + Math.max(0, tuning.defenseBias) * 0.35;

		if (isLooseBall(ctx.ballVel)) {
			return "ALIGN_SHOT";
		}

		if (role === "striker") {
			if (distBall < engage) return "ALIGN_SHOT";
			if (isBallIdle(ctx.ballVel)) return "ALIGN_SHOT";
			if (isBehindBall(pos, ctx.ballPos, enemyGoal)) return "ALIGN_SHOT";
			if (
				shouldRepositionAroundBall(
					pos,
					ctx.ballPos,
					ctx.ballVel,
					enemyGoal,
					engage,
				)
			) {
				return "REPOSITION";
			}
			return "ALIGN_SHOT";
		}

		if (role === "goalie") {
			if (this.clearanceActive) return "ALIGN_SHOT";
			if (isBallIdle(ctx.ballVel) && distBall < 32) return "ALIGN_SHOT";
			return distBall < 16 * tuning.aggression * defenseMul
				? "ALIGN_SHOT"
				: "REPOSITION";
		}

		// support
		if (distBall < press) return "ALIGN_SHOT";
		if (this.clearanceActive) return "ALIGN_SHOT";
		const ballZ = ctx.ballPos.z;
		const attackingHalf =
			this.team === "blue"
				? ballZ > -8
				: this.team === "orange"
					? ballZ < 8
					: Math.abs(ballZ) > 8;
		if (attackingHalf) return "ALIGN_SHOT";
		return distBall > 28 / tuning.aggression ? "REPOSITION" : "ALIGN_SHOT";
	}

	private pickTarget(
		out: THREE.Vector3,
		state: BotFsmState,
		role: BotRole,
		ctx: BehaviorContext,
		pos: THREE.Vector3,
		enemyGoal: THREE.Vector3,
		ownGoal: THREE.Vector3,
		tuning: BotLearningTuning,
	): void {
		if (state === "RECOVERY") {
			out.copy(ARENA_CENTER);
			out.y = 0;
			return;
		}

		if (state === "AERIAL") {
			const horizDist = Math.hypot(
				ctx.ballPos.x - pos.x,
				ctx.ballPos.z - pos.z,
			);
			if (horizDist < 12) {
				out.copy(ctx.ballPos);
			} else {
				out.copy(ctx.intercept);
			}
			// Cel zawsze na wysokości piłki — zero „duchów” nad areną
			out.y = ctx.ballPos.y;
			return;
		}

		if (state === "REPOSITION") {
			if (isLooseBall(ctx.ballVel)) {
				out.copy(ctx.intercept);
				return;
			}
			this.repositionTarget(out, ctx, pos, ownGoal, role);
			return;
		}

		const distBall = pos.distanceTo(ctx.ballPos);
		const shotBias = 0.9 + tuning.aggression * 0.12;
		if (distBall > 14) {
			out.copy(ctx.intercept);
		} else if (distBall > 2.5) {
			out.copy(ctx.ballPos);
		} else {
			_shotLine.copy(enemyGoal).sub(ctx.ballPos);
			_shotLine.y = 0;
			if (_shotLine.lengthSq() > 0.01) {
				_shotLine.normalize();
				out.copy(ctx.ballPos).addScaledVector(_shotLine, shotBias);
			} else {
				out.copy(ctx.ballPos);
			}
		}

		if (role === "support" && distBall > 8) {
			_shotLine.copy(enemyGoal).sub(ctx.ballPos);
			_shotLine.y = 0;
			if (_shotLine.lengthSq() > 0.01) {
				_shotLine.normalize();
				const lane = (this.slotIndex % 3) - 1;
				_offset.set(-_shotLine.z, 0, _shotLine.x).multiplyScalar(lane * 5);
				out.add(_offset);
			}
		}
	}

	private repositionTarget(
		out: THREE.Vector3,
		ctx: BehaviorContext,
		pos: THREE.Vector3,
		ownGoal: THREE.Vector3,
		role: BotRole,
	): void {
		this.defensiveAnchor(out, ownGoal);

		_botToBall.copy(ctx.ballPos).sub(pos);
		_botToBall.y = 0;
		if (_botToBall.lengthSq() > 1) {
			_botToBall.normalize();
			_shotLine.set(-_botToBall.z, 0, _botToBall.x);
			const side = this.slotIndex % 2 === 0 ? 1 : -1;
			out.addScaledVector(_shotLine, side * 10);
		}

		if (role === "goalie") {
			_shotLine.copy(ctx.ballPos).sub(ownGoal);
			_shotLine.y = 0;
			if (_shotLine.lengthSq() > 0.01) {
				_shotLine.normalize();
				out.addScaledVector(
					_shotLine,
					THREE.MathUtils.clamp(pos.distanceTo(ctx.ballPos) * 0.1, 2, 6),
				);
			}
		}
	}

	private defensiveAnchor(out: THREE.Vector3, ownGoal: THREE.Vector3): void {
		out.set(ownGoal.x * 0.12, 0, ownGoal.z * 0.52);
	}

	private steerTowardTarget(targetPos: THREE.Vector3, player: Player): number {
		return applyVectorSteering(this.simulatedInput, targetPos, player);
	}

	private applyWallAvoidance(
		targetPos: THREE.Vector3,
		pos: THREE.Vector3,
		player: Player,
	): void {
		const nearX = Math.abs(pos.x) > WALL_X_THRESHOLD;
		const nearZ = Math.abs(pos.z) > WALL_Z_THRESHOLD;
		if (!nearX && !nearZ) return;

		_toCenter.copy(ARENA_CENTER).sub(pos);
		_toCenter.y = 0;
		if (_toCenter.lengthSq() > 0.01) {
			_toCenter.normalize();
			targetPos.copy(pos).addScaledVector(_toCenter, 14);
		} else {
			targetPos.copy(ARENA_CENTER);
		}
		targetPos.y = 0;

		_fwd.copy(player.getForward());
		_fwd.y = 0;
		if (_fwd.lengthSq() < 1e-6) return;
		_fwd.normalize();

		let drivingIntoWall = false;
		if (nearX && _fwd.x * Math.sign(pos.x) > 0.55) drivingIntoWall = true;
		if (nearZ && _fwd.z * Math.sign(pos.z) > 0.55) drivingIntoWall = true;
		if (drivingIntoWall) {
			this.wallReverseFramesLeft = WALL_REVERSE_FRAMES;
		}
	}

	private applyBoost(
		input: SimulatedInput,
		player: Player,
		crossY: number,
		distToTarget: number,
		tuning: BotLearningTuning,
	): void {
		if (this.fsmState === "AERIAL" && !player.isOnGround()) {
			return;
		}

		input.boost = false;
		const fwdAxis =
			input.forwardAxis ?? (input.forward ? 1 : input.backward ? -1 : 0);
		if (fwdAxis <= 0.12) return;

		const speed = player.getVelocity().length();
		if (player.getBoostFuel() <= 0.03) return;

		if (this.chasingLooseBall && distToTarget > 5) {
			const looseAligned = Math.abs(crossY) <= 0.34;
			if (looseAligned || distToTarget > 12) {
				input.boost = speed < RL_CAR.maxSpeed - 0.35;
				return;
			}
		}

		const aligned = Math.abs(crossY) <= BOOST_ALIGN_TOLERANCE;
		const minDist = BOOST_MIN_DIST * tuning.boostDistanceMul;
		const biasBoost = tuning.boostBias > 0.35 && distToTarget > minDist * 0.65;
		if (
			(aligned &&
				distToTarget > minDist &&
				speed < RL_CAR.maxSpeed - 0.5 &&
				player.getBoostFuel() > 0.05) ||
			biasBoost
		) {
			input.boost = true;
		}
	}

	private applyAerialTakeoff(
		input: SimulatedInput,
		player: Player,
		ctx: BehaviorContext,
		pos: THREE.Vector3,
		ownGoal: THREE.Vector3,
		role: BotRole,
		tuning: BotLearningTuning,
	): boolean {
		if (this.jumpCooldown > 0 || !player.isOnGround()) return false;
		if (this.fsmState === "AERIAL") return false;

		const defending = ballThreatensOwnGoal(ctx.ballPos, ctx.ballVel, ownGoal);
		const aerialMinY = 1.65 - tuning.aerialBias * 0.35;
		if (!isBallAirborne(ctx.ballPos, ctx.ballVel, aerialMinY)) return false;

		const horizDist = Math.hypot(ctx.ballPos.x - pos.x, ctx.ballPos.z - pos.z);
		const maxDist = defending
			? 6.5 + tuning.aerialBias * 4
			: 5.5 + tuning.aerialBias * 5;
		if (horizDist > maxDist) return false;

		if (!defending && tuning.aerialBias < 0.32 && role === "goalie") {
			return false;
		}

		this.requestHeuristicJump();
		if (player.getBoostFuel() > 0.04) {
			input.boost = true;
		}
		this.fsmState = "AERIAL";
		return true;
	}

	private applyAerialControl(
		input: SimulatedInput,
		player: Player,
		ctx: BehaviorContext,
		ownGoal: THREE.Vector3,
		tuning: BotLearningTuning,
	): void {
		const pos = player.getPosition();
		const horizDist = Math.hypot(ctx.ballPos.x - pos.x, ctx.ballPos.z - pos.z);
		const ballY = ctx.ballPos.y;
		const defending = ballThreatensOwnGoal(ctx.ballPos, ctx.ballVel, ownGoal);
		const engaged = isBallAirborne(
			ctx.ballPos,
			ctx.ballVel,
			defending ? 1.4 : 1.55,
		);
		const inAir = !player.isOnGround();
		const fuel = player.getBoostFuel();
		const ballAbove = ballY > pos.y + 0.2;

		if (!engaged) {
			this.fsmState = "ALIGN_SHOT";
			return;
		}

		if (fuel > 0.03) {
			if (defending && (ballAbove || horizDist < 14)) {
				input.boost = true;
			} else if (inAir) {
				if (ballAbove && horizDist < 20) {
					input.boost = true;
				}
				if (horizDist > 5 && horizDist < 24 && ballAbove) {
					input.boost = true;
				}
			} else if (ballAbove && horizDist < 10) {
				input.boost = true;
			}
		}

		if (inAir && horizDist < 6.5 && ballAbove && ballY > 1.1) {
			this.requestHeuristicJump();
		}

		if (horizDist > 14 && tuning.aerialBias > 0.3) {
			input.forward = true;
		}
	}

	private applyFrontFlip(
		player: Player,
		role: BotRole,
		ctx: BehaviorContext,
		pos: THREE.Vector3,
		ownGoal: THREE.Vector3,
	): void {
		if (role === "goalie" || ctx.kickoffActive || isLooseBall(ctx.ballVel)) {
			this.frontFlipPhase = "none";
			return;
		}
		if (ballThreatensOwnGoal(ctx.ballPos, ctx.ballVel, ownGoal, 0.8)) {
			this.frontFlipPhase = "none";
			return;
		}

		const distBall = pos.distanceTo(ctx.ballPos);
		const carSpeed = player.getVelocity().length();
		const wantFlip =
			distBall > 28 &&
			carSpeed > 8 &&
			player.isOnGround() &&
			(this.fsmState === "ALIGN_SHOT" || this.clearanceActive);

		if (this.frontFlipPhase === "none" && wantFlip) {
			this.frontFlipPhase = "first";
		}

		if (this.frontFlipPhase === "first") {
			this.armForcedJump();
			if (!player.isOnGround()) {
				this.frontFlipPhase = "flip";
			}
		} else if (this.frontFlipPhase === "flip") {
			this.armForcedJump();
			this.simulatedInput.forward = true;
			this.frontFlipPhase = "none";
		}
	}

	private applyJump(
		player: Player,
		role: BotRole,
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		pos: THREE.Vector3,
		enemyGoal: THREE.Vector3,
		ownGoal: THREE.Vector3,
	): void {
		if (this.jumpCooldown > 0) return;
		if (!player.isOnGround()) return;
		if (isLooseBall(ballVel) && !this.clearanceActive && role !== "goalie") {
			return;
		}

		_fwd.copy(player.getForward());
		if (
			!shouldJumpForBall(pos, _fwd, ballPos, ballVel, enemyGoal, ownGoal, {
				role,
				clearanceActive: this.clearanceActive,
			})
		) {
			return;
		}

		this.requestHeuristicJump();
	}

	private applyPeerSpread(
		targetPos: THREE.Vector3,
		ctx: BehaviorContext,
		pos: THREE.Vector3,
	): void {
		if (isLooseBall(ctx.ballVel)) return;

		for (const peer of ctx.peers) {
			if (peer.slotIndex === this.slotIndex) continue;
			const sep = pos.distanceTo(peer.position);
			if (sep > 7 || sep < 0.01) continue;
			_offset
				.copy(pos)
				.sub(peer.position)
				.normalize()
				.multiplyScalar((7 - sep) * 0.55);
			targetPos.add(_offset);
		}
	}

	private updateClearance(
		role: BotRole,
		ctx: BehaviorContext,
		ownGoal: THREE.Vector3,
	): void {
		if (role !== "goalie") {
			this.clearanceActive = false;
			return;
		}

		_goalDir.copy(ownGoal).sub(ctx.ballPos);
		_goalDir.y = 0;
		if (_goalDir.lengthSq() > 0.01) _goalDir.normalize();

		const velTowardGoal =
			ctx.ballVel.x * _goalDir.x + ctx.ballVel.z * _goalDir.z;
		const inOurHalf =
			this.team === "blue"
				? ctx.ballPos.z < 0
				: this.team === "orange"
					? ctx.ballPos.z > 0
					: Math.abs(ctx.ballPos.z) > RL_ARENA.HALF_LENGTH * 0.5;

		this.clearanceActive = inOurHalf && velTowardGoal > 2;
	}

	private applyIgnition(
		drive: BotDrive,
		player: Player,
		role: BotRole,
		ctx: BehaviorContext,
		ignition: IgnitionManager | null,
	): BotDrive {
		if (!ignition?.isEnabled()) return drive;
		const used = ignition.tryBotActivate(
			this.slotIndex,
			player,
			this.team,
			role,
			this.fsmState,
			ctx,
		);
		if (used && ignition.hasSpikesGrip(this.slotIndex)) {
			this.forceSpikesRush();
		}
		return drive;
	}

	private attackGoal(ctx: BehaviorContext): THREE.Vector3 {
		if (ctx.isFFA || !this.team) {
			const toBlue = ctx.ballPos.distanceToSquared(GOAL_BLUE);
			const toOrange = ctx.ballPos.distanceToSquared(GOAL_ORANGE);
			return toBlue < toOrange ? GOAL_BLUE : GOAL_ORANGE;
		}
		return this.team === "blue" ? GOAL_BLUE : GOAL_ORANGE;
	}

	private defendGoal(): THREE.Vector3 {
		if (this.team === "blue") return GOAL_ORANGE;
		if (this.team === "orange") return GOAL_BLUE;
		return GOAL_ORANGE;
	}
}
