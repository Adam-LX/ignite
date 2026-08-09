import * as THREE from "three";
import type { ScoringTeam } from "../game/modes";
import type { IgnitionManager } from "../modes/IgnitionManager";
import type Player from "../util/Player";
import { RL_CAR, RL_HOVER } from "../util/rlConstants";
import {
	createEmptySimulatedInput,
	type SimulatedInput,
} from "../util/SimulatedInput";
import { RL_ARENA } from "../visual/arenaConstants";
import {
	isMeridianArenaActive,
	meridianSphereRadius,
} from "../visual/meridianArena";
import type { BotRole } from "./AIManager";
import { BOT_TURTLE_UP_THRESHOLD, isBotUnstable } from "./botRecovery";
import {
	ballThreatensOwnGoal,
	isBackboardBall,
	isBallAirborne,
	isBallIdle,
	isBehindBall,
	isKickoffChasePhase,
	isLooseBall,
	pickNearestBoostPad,
	shouldChaseKickoffBall,
	shouldJumpForBall,
	shouldRepositionAroundBall,
	shouldSeekBoostPad,
	computeStrikeApproachTarget,
	isAlignedForShot,
	type BotBoostPadInfo,
} from "./botTactics";
import { applyLearnedTargetOffset } from "./learning/BotLearnedTargeting";
import { BotLearning } from "./learning/BotLearning";
import type { BotLearningTuning } from "./learning/BotLearningTuning";
import { NEUTRAL_TUNING } from "./learning/BotLearningTuning";

export type { SimulatedInput } from "../util/SimulatedInput";

export type BotFsmState = "ALIGN_SHOT" | "REPOSITION" | "RECOVERY" | "AERIAL";

export type BotDrive = {
	forward: number;
	yaw: number;
	boost: boolean;
	jump?: boolean;
	/** Powerslide / air-roll. */
	shift?: boolean;
	/** Ciągły gaz — gdy ustawiony, ma pierwszeństwo przy blendzie z siecią. */
	forwardAxis?: number;
	yawAxis?: number;
	rollAxis?: number;
};

export type BotPeer = {
	slotIndex: number;
	team: ScoringTeam | null;
	position: THREE.Vector3;
	isHuman: boolean;
	spawnRole?: import("../modes/MatchController").SpawnRole;
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
	/** Aktywne pady — ekonomia RL (brak passive regen). */
	boostPads?: readonly BotBoostPadInfo[];
};

const GOAL_BLUE = new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH);
const GOAL_ORANGE = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);
const ARENA_CENTER = new THREE.Vector3(0, 0, 0);

const WALL_ESCAPE_MARGIN = 4;
const WALL_X_THRESHOLD = RL_ARENA.HALF_WIDTH - WALL_ESCAPE_MARGIN;
const WALL_Z_THRESHOLD = RL_ARENA.HALF_LENGTH - WALL_ESCAPE_MARGIN;
const WALL_REVERSE_FRAMES = 8;
const STEER_YAW_GAIN = 2.35;
const STEER_DEADZONE = 0.055;
const TARGET_SMOOTH_LAMBDA = 8.5;
const DRIVE_FWD_DAMP = 11;
const DRIVE_YAW_DAMP = 13;
const BOOST_ALIGN_TOLERANCE = 0.15;
const BOOST_MIN_DIST = 10;
const DODGE_BALL_MAX_DIST = 5.0;
const DODGE_ALIGN_TOLERANCE = 0.2;
/** Krótszy CD — więcej finish dodge’ów (probe: 0 goli przy wysokich touchach). */
const FLIP_ACTION_COOLDOWN_SEC = 1.45;

const _fwd = new THREE.Vector3();
const _targetDir = new THREE.Vector3();
const _target = new THREE.Vector3();
const _shotLine = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _goalDir = new THREE.Vector3();
const _botToBall = new THREE.Vector3();
const _toCenter = new THREE.Vector3();
const _surfN = new THREE.Vector3();
const _meridianGoal = new THREE.Vector3();
const _crossScratch = new THREE.Vector3();

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
			shift: input.shift === true,
			forwardAxis: input.forwardAxis,
			yawAxis: input.yawAxis,
			rollAxis: input.rollAxis,
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
		shift: input.shift === true,
		rollAxis: input.rollAxis,
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

function projectOntoTangent(
	v: THREE.Vector3,
	normal: THREE.Vector3,
): THREE.Vector3 {
	const d = v.dot(normal);
	v.addScaledVector(normal, -d);
	return v;
}

/** Proporcjonalny skręt — zamiast pełnego A/D przy każdym progu. */
export function computeAnalogSteer(
	targetPos: THREE.Vector3,
	player: Player,
): { forward: number; yaw: number; crossY: number } {
	const botPos = player.getPosition();
	const meridian = isMeridianArenaActive();
	const onWall =
		!meridian &&
		player.isOnWallOrRamp() &&
		player.getSurfaceNormal().y < RL_CAR.wallNormalFlatThreshold;
	const surfaceSteer = meridian || onWall;

	_fwd.copy(player.getForward());
	_targetDir.subVectors(targetPos, botPos);

	if (surfaceSteer) {
		_surfN.copy(player.getSurfaceNormal());
		if (_surfN.lengthSq() < 1e-6) _surfN.set(0, 1, 0);
		else _surfN.normalize();
		projectOntoTangent(_fwd, _surfN);
		projectOntoTangent(_targetDir, _surfN);
	} else {
		_fwd.y = 0;
		_targetDir.y = 0;
	}

	if (_fwd.lengthSq() < 1e-6) {
		if (surfaceSteer) {
			_fwd.set(0, 0, 1);
			projectOntoTangent(_fwd, _surfN);
		} else {
			_fwd.set(0, 0, 1);
		}
	}
	_fwd.normalize();

	const dist = _targetDir.length();
	if (dist < 0.05) return { forward: 0, yaw: 0, crossY: 0 };
	_targetDir.normalize();

	const dot = _fwd.dot(_targetDir);
	const crossY = surfaceSteer
		? _surfN.dot(_crossScratch.copy(_fwd).cross(_targetDir))
		: _fwd.z * _targetDir.x - _fwd.x * _targetDir.z;

	if (!player.isOnGround()) {
		let yaw = THREE.MathUtils.clamp(crossY * 1.85, -1, 1);
		if (Math.abs(yaw) < STEER_DEADZONE) yaw = 0;
		const forward =
			dot > -0.15 ? THREE.MathUtils.clamp(0.38 + dot * 0.58, 0.32, 1) : 0;
		return { forward, yaw, crossY };
	}

	let yaw = THREE.MathUtils.clamp(crossY * STEER_YAW_GAIN, -1, 1);
	const steerDeadzone = dist < 2.5 ? STEER_DEADZONE * 1.75 : STEER_DEADZONE;
	if (Math.abs(yaw) < steerDeadzone) yaw = 0;

	let forward = 0;
	if (dot > -0.35) {
		forward = THREE.MathUtils.clamp(0.22 + dot * 0.88, 0.38, 1);
		forward *= 1 - Math.min(0.38, Math.abs(crossY) * 0.42);
		if (surfaceSteer) {
			/** Ściana / Meridian: trzymaj gaz — possession wymaga ciągłego ruchu. */
			forward = Math.max(forward, onWall ? 0.82 : 0.72);
		}
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
	private aerialCooldown = 0;
	/** Shared flip/dodge/kickoff cooldown. */
	private flipActionCooldown = 0;
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
	private recoveryJumpCooldown = 0;
	/** Czas ciągłego RECOVERY — po limicie twardy snap na koła (anty-klin). */
	private recoveryStuckSec = 0;

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
		this.flipActionCooldown = 0;
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
		this.aerialCooldown = Math.max(0, this.aerialCooldown - dt);
		this.flipActionCooldown = Math.max(0, this.flipActionCooldown - dt);
		this.kickoffDelay = Math.max(0, this.kickoffDelay - dt);

		const kickoffChase =
			shouldChaseKickoffBall(role, ctx.isFFA, ctx.teamSize) &&
			isKickoffChasePhase(
				ctx.ballPos,
				ctx.ballVel,
				ctx.kickoffActive,
				this.kickoffDelay,
			);

		const tuning = {
			...(kickoffChase
				? NEUTRAL_TUNING
				: BotLearning.get().beginThink(this.slotIndex, player, role, {
						ballPos: ctx.ballPos,
						ballVel: ctx.ballVel,
						team: this.team,
						role,
						isFFA: ctx.isFFA,
					})),
		};

		/** Blisko piłki — heurystyka finishu > ML (2v2: autonomia psuje punch). */
		const distBallForPolicy = player.getPosition().distanceTo(ctx.ballPos);
		if (!kickoffChase && distBallForPolicy < 10) {
			tuning.policyAutonomy = Math.min(tuning.policyAutonomy, 0.12);
			tuning.strikeApproach = Math.max(tuning.strikeApproach, 0.85);
		}
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

		// Turtle / bok / dach — pełny recovery, zero chase (sieć wyłączona w BotLearning)
		if (isBotUnstable(player)) {
			this.forceRecoveryJump = true;
			this.fsmState = "RECOVERY";
			this.recoveryStuckSec += dt;
			this.applyRecoveryControl(this.simulatedInput, player, dt);
			const upY = player.getUpward().y;
			/** Bok na krawędzi — szybszy snap (2.2 s zostawiało jeżdżącego „bokiem”). */
			const stuckLimit = upY < 0.35 && pos.y < 1.6 ? 0.95 : 2.2;
			if (this.recoveryStuckSec > stuckLimit && pos.y < 2.2) {
				const yaw = Math.atan2(player.getForward().x, player.getForward().z);
				player.resetKickoffPose(pos.x, 1.4, pos.z, yaw);
				this.recoveryStuckSec = 0;
				/** Nie skacz od razu po snapie — wheels=0 przez 1 klatkę i jump psuje reset. */
				this.recoveryJumpCooldown = 0.55;
				this.forceRecoveryJump = false;
				this.heuristicJumpRequest = false;
			}
			return this.finishThink(player, role, ctx, ignition, dt, ownGoal, true);
		}
		this.recoveryStuckSec = 0;

		if (this.spikesRush) {
			this.fsmState = "ALIGN_SHOT";
			_target.copy(enemyGoal);
			_target.y = Math.max(0, ctx.ballPos.y * 0.35);
			this.smoothSteerTarget(_target, dt, true, 0);
			this.lastTargetDist = pos.distanceTo(this.smoothedTarget);
			this.lastCrossY = this.steerTowardTarget(this.smoothedTarget, player);
			this.simulatedInput.forwardAxis = 1;
			this.simulatedInput.forward = true;
			this.simulatedInput.backward = false;
			this.simulatedInput.boost = player.getBoostFuel() > 0.01;
			this.smoothDriveFwd = 1;
			syncBooleansFromAxes(this.simulatedInput);
			if (pos.distanceTo(enemyGoal) < 8) this.spikesRush = false;
			return this.finishThink(player, role, ctx, ignition, dt, ownGoal);
		}

		this.updateClearance(role, ctx, ownGoal);

		if (kickoffChase) {
			this.runKickoffChase(role, ctx);
		} else if (ctx.kickoffActive || this.kickoffDelay > 0) {
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
			void defendingHigh;
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

		this.applyWallAvoidance(_target, pos, player, ctx.ballPos);

		this.applyPeerSpread(_target, ctx, pos);
		this.applyDemoAvoidance(_target, ctx, pos);

		if (!kickoffChase) {
			this.maybeDivertToBoostPad(
				_target,
				player,
				role,
				ctx,
				pos,
				ownGoal,
				kickoffChase,
			);
		} else if (
			!ctx.kickoffActive &&
			player.getBoostFuel() < 0.12 &&
			this.kickoffDelay <= 0
		) {
			/** Po GO, fuel spalony — pozwól na pad mimo residual chase phase. */
			this.maybeDivertToBoostPad(
				_target,
				player,
				role,
				ctx,
				pos,
				ownGoal,
				false,
			);
		}

		if (!kickoffChase) {
			applyLearnedTargetOffset(
				_target,
				{
					ballPos: ctx.ballPos,
					ballVel: ctx.ballVel,
					botPos: pos,
					enemyGoal,
					fsmState: this.fsmState,
				},
				tuning,
			);
		}

		this.smoothSteerTarget(
			_target,
			dt,
			kickoffChase || ctx.kickoffActive || this.kickoffDelay > 0,
			kickoffChase ? 0 : tuning.policyAutonomy,
		);

		this.lastTargetDist = pos.distanceTo(this.smoothedTarget);
		this.lastCrossY = this.steerTowardTarget(this.smoothedTarget, player);

		if (kickoffChase && this.dodgePhase === "none") {
			this.tryKickoffFlip(player, pos, ctx.ballPos, this.lastCrossY);
		}

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
			if (!kickoffChase) {
				this.tryStartDodge(
					player,
					role,
					pos,
					ctx.ballPos,
					ctx.ballVel,
					ownGoal,
					enemyGoal,
					this.lastCrossY,
				);
			}
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
			this.applyRecoveryControl(this.simulatedInput, player, dt);
		} else if (!kickoffChase) {
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

		/** Blisko piłki i wyrównany — dociśnij gaz (mniej orbitowania / dead hits). */
		if (
			!kickoffChase &&
			this.fsmState === "ALIGN_SHOT" &&
			this.dodgePhase === "none" &&
			this.lastTargetDist < 4.6 &&
			Math.abs(this.lastCrossY) < 0.28
		) {
			this.simulatedInput.forwardAxis = 1;
			this.simulatedInput.forward = true;
			this.simulatedInput.backward = false;
			this.smoothDriveFwd = 1;
			syncBooleansFromAxes(this.simulatedInput);
			if (
				this.lastTargetDist < 3.2 &&
				Math.abs(this.lastCrossY) < 0.18 &&
				player.getBoostFuel() > 0.08
			) {
				this.simulatedInput.boost = true;
			}
		}

		if (kickoffChase) {
			this.applyKickoffDrive(player, ctx, pos);
		}

		return this.finishThink(
			player,
			role,
			ctx,
			ignition,
			dt,
			ownGoal,
			kickoffChase,
		);
	}

	private requestHeuristicJump(): void {
		if (this.jumpCooldown > 0) return;
		this.heuristicJumpRequest = true;
	}

	private armForcedJump(frames = 2): void {
		this.forcedJumpFrames = Math.max(this.forcedJumpFrames, frames);
	}

	private applyRecoveryControl(
		input: SimulatedInput,
		player: Player,
		dt: number,
	): void {
		this.recoveryJumpCooldown = Math.max(0, this.recoveryJumpCooldown - dt);
		this.dodgePhase = "none";
		this.frontFlipPhase = "none";
		this.triggerDodgeSequence = false;

		input.forward = false;
		input.backward = false;
		input.forwardAxis = 0;
		input.left = false;
		input.right = false;
		input.yawAxis = 0;
		input.rollAxis = 0;
		input.shift = false;
		input.boost = false;
		this.smoothDriveFwd = 0;
		this.smoothDriveYaw = 0;

		const up = player.getUpward();
		const fwd = player.getForward();
		const side = player.getSideward();
		const n = player.getSurfaceNormal();
		const onWall =
			player.isOnWallOrRamp() &&
			n.y < RL_CAR.wallNormalFlatThreshold;
		const align =
			isMeridianArenaActive() || onWall
				? up.x * n.x + up.y * n.y + up.z * n.z
				: up.y;
		const wheels = player.getWheelsGroundedCount();
		const inAir = wheels < RL_HOVER.groundedMinWheels;

		if (
			this.recoveryJumpCooldown <= 0 &&
			align < 0.62 &&
			(align < 0.35 ||
				wheels < 4 ||
				player.getPosition().y > 1.6 ||
				inAir)
		) {
			this.armForcedJump(2);
			this.recoveryJumpCooldown = align < BOT_TURTLE_UP_THRESHOLD ? 0.22 : 0.34;
		}

		/**
		 * Air-roll jak gracz: Shift + A/D. Bez shift yaw w powietrzu tylko kręci
		 * heading — stąd wcześniej ~35% fail recovery.
		 */
		const tipSide =
			isMeridianArenaActive() || onWall ? side.dot(n) : side.y;
		const tipNose =
			isMeridianArenaActive() || onWall ? fwd.dot(n) : fwd.y;

		if (align < 0.88) {
			input.shift = true;
			if (Math.abs(tipSide) > 0.04) {
				input.yawAxis = tipSide >= 0 ? 1 : -1;
			} else if (align < BOT_TURTLE_UP_THRESHOLD) {
				/** Turtle — wymuś beczkę w jedną stronę. */
				input.yawAxis = 1;
			}
			if (inAir && Math.abs(tipNose) > 0.08) {
				input.forwardAxis = THREE.MathUtils.clamp(-tipNose * 1.55, -1, 1);
			}
			this.smoothDriveYaw = input.yawAxis ?? 0;
			this.smoothDriveFwd = input.forwardAxis ?? 0;
		}
	}

	private finishThink(
		player: Player,
		role: BotRole,
		ctx: BehaviorContext,
		ignition: IgnitionManager | null,
		dt: number,
		ownGoal: THREE.Vector3,
		bypassLearning = false,
	): BotDrive {
		const defending = ballThreatensOwnGoal(ctx.ballPos, ctx.ballVel, ownGoal);
		const driveBase = simulatedToDrive(this.simulatedInput);
		driveBase.forwardAxis = this.simulatedInput.forwardAxis;
		driveBase.yawAxis = this.simulatedInput.yawAxis;
		driveBase.jump = this.simulatedInput.jump;
		driveBase.boost = this.simulatedInput.boost;

		const skipNetwork =
			bypassLearning || ctx.kickoffCountdown || ctx.kickoffDriveLocked;

		const drive = skipNetwork
			? driveBase
			: BotLearning.get().think(
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
			/** Recovery: krótszy cooldown — seria flipów na koła. */
			this.jumpCooldown = this.fsmState === "RECOVERY" ? 0.28 : 0.85;
		}

		this.applyDriveToSimulated(drive, dt);
		player.updateInputs(this.simulatedInput, dt);
		return this.applyIgnition(drive, player, role, ctx, ignition);
	}

	/** Ustawia cel kickoffu na piłkę (sterowanie w głównym flow). */
	private runKickoffChase(role: BotRole, ctx: BehaviorContext): void {
		if (this.kickoffDelay > 0.04) {
			this.fsmState = "ALIGN_SHOT";
			return;
		}

		this.fsmState = "ALIGN_SHOT";
		_target.copy(ctx.ballPos);
		if (ctx.ballVel.lengthSq() > 0.04) {
			_target.addScaledVector(ctx.ballVel, 0.22);
		}
		_target.y = Math.max(0, ctx.ballPos.y);

		if (role === "support" && ctx.teamSize >= 3) {
			_offset.set(this.slotIndex % 2 === 0 ? 2.5 : -2.5, 0, 0);
			_target.add(_offset);
		}
	}

	private applyKickoffDrive(
		player: Player,
		ctx: BehaviorContext,
		pos: THREE.Vector3,
	): void {
		if (this.kickoffDelay > 0.04) return;

		const dist = pos.distanceTo(ctx.ballPos);
		const aligned = Math.abs(this.lastCrossY) < 0.38;
		const fuel = player.getBoostFuel();
		const speed = player.getVelocity().length();

		// Kickoff chase: pełny gaz — steer daje za mały forward przy ostrym skręcie.
		if (aligned || dist > 8) {
			this.simulatedInput.forwardAxis = 1;
			this.simulatedInput.forward = true;
			this.simulatedInput.backward = false;
			this.smoothDriveFwd = 1;
			syncBooleansFromAxes(this.simulatedInput);
		}

		const fwd =
			this.simulatedInput.forwardAxis ?? (this.simulatedInput.forward ? 1 : 0);
		/**
		 * Spawn 33% — boost tylko w oknie mid-range, zostaw rezerwę na pad/aerial.
		 * Nie boostuj gdy już ~throttle max (gaz wystarczy).
		 */
		if (
			fwd > 0.1 &&
			aligned &&
			fuel > 0.12 &&
			dist > 7 &&
			dist < 22 &&
			speed < RL_CAR.throttleMaxSpeed - 0.4
		) {
			this.simulatedInput.boost = true;
		}
	}

	private tryKickoffFlip(
		player: Player,
		pos: THREE.Vector3,
		ballPos: THREE.Vector3,
		crossY: number,
	): void {
		if (this.flipActionCooldown > 0 || this.dodgePhase !== "none") return;
		if (!player.isOnGround()) return;

		const dist = pos.distanceTo(ballPos);
		const speed = player.getVelocity().length();
		if (dist < 2.8 || dist > 9) return;
		if (Math.abs(crossY) > 0.16) return;
		/** Niższy próg — boty startują z 33% boosta. */
		if (speed < 4.0) return;

		this.triggerDodgeSequence = true;
		this.dodgePhase = "jump1";
		this.dodgeFramesLeft = 2;
		this.flipActionCooldown = FLIP_ACTION_COOLDOWN_SEC;
	}

	private smoothSteerTarget(
		target: THREE.Vector3,
		dt: number,
		snap: boolean,
		policyAutonomy = 0,
	): void {
		if (snap || !this.hasSmoothedTarget) {
			this.smoothedTarget.copy(target);
			this.hasSmoothedTarget = true;
			return;
		}
		const lambda = TARGET_SMOOTH_LAMBDA * (1 + policyAutonomy * 0.55);
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
		const targetFwd =
			drive.forwardAxis ?? (drive.forward > 0 ? 1 : drive.forward < 0 ? -1 : 0);
		const targetYaw =
			drive.yawAxis ?? (drive.yaw > 0 ? 1 : drive.yaw < 0 ? -1 : 0);

		/** Recovery / air-roll — bez damp (inaczej Shift+steer jest za wolny). */
		if (drive.shift || this.fsmState === "RECOVERY") {
			this.smoothDriveFwd = targetFwd;
			this.smoothDriveYaw = targetYaw;
		} else {
			this.smoothDriveFwd = THREE.MathUtils.damp(
				this.smoothDriveFwd,
				targetFwd,
				DRIVE_FWD_DAMP,
				dt,
			);
			this.smoothDriveYaw = THREE.MathUtils.damp(
				this.smoothDriveYaw,
				targetYaw,
				DRIVE_YAW_DAMP,
				dt,
			);
		}

		const fwd = Math.abs(this.smoothDriveFwd) < 0.03 ? 0 : this.smoothDriveFwd;
		const yaw = Math.abs(this.smoothDriveYaw) < 0.03 ? 0 : this.smoothDriveYaw;

		this.simulatedInput.forwardAxis = fwd;
		this.simulatedInput.yawAxis = yaw;
		this.simulatedInput.rollAxis = drive.rollAxis ?? 0;
		this.simulatedInput.shift = drive.shift === true;
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
		enemyGoal: THREE.Vector3,
		crossY: number,
	): void {
		if (role !== "striker" && role !== "support") return;
		if (this.triggerDodgeSequence || this.dodgePhase !== "none") return;
		if (this.flipActionCooldown > 0) return;
		if (ballThreatensOwnGoal(ballPos, ballVel, ownGoal, 0.8)) return;

		const distanceToBall = pos.distanceTo(ballPos);
		const speed = player.getVelocity().length();
		const aerialDodge = isBallAirborne(ballPos, ballVel, 1.75);
		const powerShotDodge =
			ballVel.length() > 10 && ballPos.y > 1.15 && ballPos.y < 4.5;
		/**
		 * Finish na ziemi — także przy luźnej/idle piłce (wcześniej `!isLooseBall`
		 * blokowało strzał właśnie wtedy, gdy boty najczęściej podjeżdżają).
		 * Blisko bramki: luźniejszy próg (2v2 mid-fight → mało finishów).
		 */
		const nearEnemyGoal = pos.distanceTo(enemyGoal) < 48;
		const groundShotDodge =
			ballPos.y < (nearEnemyGoal ? 2.45 : 2.25) &&
			distanceToBall < (nearEnemyGoal ? 5.5 : 5.1) &&
			speed > (nearEnemyGoal ? 4.8 : 5.4) &&
			isAlignedForShot(
				pos,
				player.getForward(),
				ballPos,
				enemyGoal,
				nearEnemyGoal ? 0.42 : 0.52,
			);

		if (!aerialDodge && !powerShotDodge && !groundShotDodge) return;

		if (
			distanceToBall <
				DODGE_BALL_MAX_DIST + (groundShotDodge ? (nearEnemyGoal ? 0.55 : 0.4) : 0) &&
			Math.abs(crossY) <
				DODGE_ALIGN_TOLERANCE +
					(groundShotDodge ? (nearEnemyGoal ? 0.22 : 0.18) : 0) &&
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
			this.flipActionCooldown = FLIP_ACTION_COOLDOWN_SEC;
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
		if (isBotUnstable(player)) {
			return "RECOVERY";
		}

		const distBall = pos.distanceTo(ctx.ballPos);
		const engage = 20 * tuning.challengeRadiusMul;
		const press = 24 * tuning.aggression;
		const defenseMul = 1 + Math.max(0, tuning.defenseBias) * 0.35;
		const ownGoal = this.defendGoal();

		/**
		 * Goalie: shadow między piłką a bramką — nie gonić mid/loose jak striker.
		 * Challenge tylko przy threat / głębokiej obronie.
		 */
		if (role === "goalie") {
			if (this.clearanceActive) return "ALIGN_SHOT";
			const threat = ballThreatensOwnGoal(ctx.ballPos, ctx.ballVel, ownGoal);
			const inDefHalf =
				this.team === "blue"
					? ctx.ballPos.z < -8
					: this.team === "orange"
						? ctx.ballPos.z > 8
						: Math.abs(ctx.ballPos.z) > 10;
			/** Midfield: nie gonić — shadow w trzeciej obronnej. */
			const ballInMid = Math.abs(ctx.ballPos.z) < 18;
			if (ballInMid && !threat) return "REPOSITION";
			if (threat && distBall < 24 * defenseMul) return "ALIGN_SHOT";
			if (inDefHalf && distBall < 9 * tuning.aggression * defenseMul) {
				return "ALIGN_SHOT";
			}
			return "REPOSITION";
		}

		if (isLooseBall(ctx.ballVel)) {
			return "ALIGN_SHOT";
		}

		if (role === "striker") {
			if (this.clearanceActive) return "ALIGN_SHOT";
			if (distBall < engage) return "ALIGN_SHOT";
			if (isBallIdle(ctx.ballVel)) return "ALIGN_SHOT";
			if (isBehindBall(pos, ctx.ballPos, enemyGoal)) return "ALIGN_SHOT";
			/** 2v2+: striker zawsze na piłce — reposition zabija finish w mid-fight. */
			if (ctx.teamSize >= 2) return "ALIGN_SHOT";
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

		// support — w 2v2 drugi gracz to pressing mate, nie lane camper
		if (ctx.teamSize <= 2) {
			if (this.clearanceActive) return "ALIGN_SHOT";
			if (distBall < press * 1.15) return "ALIGN_SHOT";
			if (isBallIdle(ctx.ballVel)) return "ALIGN_SHOT";
			if (isBehindBall(pos, ctx.ballPos, enemyGoal)) return "ALIGN_SHOT";
			return distBall > 32 / tuning.aggression ? "REPOSITION" : "ALIGN_SHOT";
		}
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
		_tuning: BotLearningTuning,
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
			/** Bez snapu na intercept — pad divert / anchor; chase zostaje w ALIGN_SHOT. */
			this.repositionTarget(out, ctx, pos, ownGoal, role);
			return;
		}

		computeStrikeApproachTarget(
			pos,
			ctx.ballPos,
			ctx.ballVel,
			enemyGoal,
			ownGoal,
			out,
		);

		/** Backboard clear — cel na piłkę wysoko (wall climb / aerial path). */
		if (this.clearanceActive && isBackboardBall(ctx.ballPos, ownGoal)) {
			out.copy(ctx.ballPos);
			out.y = Math.max(ctx.ballPos.y * 0.92, 4.2);
			/** Lekko od strony boiska, żeby wjechać w bandę a nie w bramkę. */
			out.z += -Math.sign(ownGoal.z || 1) * 1.8;
		}

		if (role === "support" && ctx.teamSize >= 3 && pos.distanceTo(ctx.ballPos) > 8) {
			_shotLine.copy(enemyGoal).sub(ctx.ballPos);
			_shotLine.y = 0;
			if (_shotLine.lengthSq() > 0.01) {
				_shotLine.normalize();
				const lane = (this.slotIndex % 3) - 1;
				_offset.set(-_shotLine.z, 0, _shotLine.x).multiplyScalar(lane * 5);
				out.add(_offset);
			}
		}

		/** Wysoka piłka / wall play — nie spłaszczaj celu do murawy. */
		if (ctx.ballPos.y > 1.8) {
			out.y = Math.max(out.y, ctx.ballPos.y * 0.85);
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
			/** Shadow: punkt na linii ownGoal → ball, bliżej bramki. */
			_shotLine.copy(ctx.ballPos).sub(ownGoal);
			_shotLine.y = 0;
			const len = _shotLine.length();
			if (len > 0.01) {
				_shotLine.multiplyScalar(1 / len);
				const depth = THREE.MathUtils.clamp(len * 0.18, 5, 11);
				out.copy(ownGoal).addScaledVector(_shotLine, depth);
				out.x = THREE.MathUtils.clamp(
					out.x,
					-RL_ARENA.HALF_WIDTH * 0.45,
					RL_ARENA.HALF_WIDTH * 0.45,
				);
				/** Nie wychodź z trzeciej obronnej — shadow, nie mid chase. */
				const minAbsZ = RL_ARENA.HALF_LENGTH * 0.58;
				if (Math.abs(out.z) < minAbsZ) {
					out.z = Math.sign(ownGoal.z || out.z || 1) * minAbsZ;
				}
			}
		}
	}

	private defensiveAnchor(out: THREE.Vector3, ownGoal: THREE.Vector3): void {
		if (isMeridianArenaActive()) {
			out.copy(ownGoal);
			return;
		}
		/** Głębszy kotwic — bliżej linii bramkowej niż środek pola. */
		out.set(ownGoal.x * 0.08, 0, ownGoal.z * 0.72);
	}

	private steerTowardTarget(targetPos: THREE.Vector3, player: Player): number {
		return applyVectorSteering(this.simulatedInput, targetPos, player);
	}

	private applyWallAvoidance(
		targetPos: THREE.Vector3,
		pos: THREE.Vector3,
		player: Player,
		ballPos: THREE.Vector3,
	): void {
		/** Flat-arena wall escape nie działa na sferze — tylko psuje tor. */
		if (isMeridianArenaActive()) return;

		/** Już na bandzie / suficie — nie ściągaj do środka (wall-ride / ceiling). */
		if (player.isOnWallOrRamp()) return;

		const nearX = Math.abs(pos.x) > WALL_X_THRESHOLD;
		const nearZ = Math.abs(pos.z) > WALL_Z_THRESHOLD;
		if (!nearX && !nearZ) return;

		/** Piłka wysoko / na bandzie — pozwól wjechać zamiast uciekać. */
		const ballNearWall =
			Math.abs(ballPos.x) > WALL_X_THRESHOLD - 2 ||
			Math.abs(ballPos.z) > WALL_Z_THRESHOLD - 2;
		if (ballPos.y > 4.5 || (ballNearWall && ballPos.y > 2.2)) return;

		const speed = player.getVelocity().length();
		/** Szybki wjazd w bandę z gazem — nie reverse'uj (wall-ride entry). */
		if (speed > 14 && (this.simulatedInput.forwardAxis ?? 0) > 0.55) return;

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

	private maybeDivertToBoostPad(
		target: THREE.Vector3,
		player: Player,
		role: BotRole,
		ctx: BehaviorContext,
		pos: THREE.Vector3,
		ownGoal: THREE.Vector3,
		kickoffChase: boolean,
	): void {
		const pads = ctx.boostPads;
		if (!pads || pads.length === 0) return;
		const fuel = player.getBoostFuel();
		const ballDist = pos.distanceTo(ctx.ballPos);
		const threat = ballThreatensOwnGoal(ctx.ballPos, ctx.ballVel, ownGoal);
		if (
			!shouldSeekBoostPad(fuel, {
				kickoffChase,
				ownGoalThreat: threat,
				looseBall: this.chasingLooseBall,
				role,
				ballDist,
			})
		) {
			return;
		}
		const pad = pickNearestBoostPad(pos.x, pos.z, pads, {
			preferBig: fuel < 0.22,
			maxDist: role === "goalie" ? 42 : 58,
		});
		if (!pad) return;
		/** Finish > pad — nie odchodź w trakcie ALIGN_SHOT blisko piłki. */
		if (
			this.fsmState === "ALIGN_SHOT" &&
			fuel >= 0.12 &&
			ballDist < 16 &&
			role === "striker"
		) {
			return;
		}
		/** Przy krytycznie niskim fuel — zawsze detour; inaczej nie gub bliskiej piłki. */
		if (fuel >= 0.14 && pad.dist > 16 && ballDist < 14 && role === "striker") {
			return;
		}
		/** Atak — nie odjeżdżaj na pad gdy piłka w 1/3 ofensywnej. */
		if (role === "striker" && fuel >= 0.1) {
			const eg = this.attackGoal(ctx);
			const attacking =
				Math.sign(eg.z || 1) === Math.sign(ctx.ballPos.z || 1) &&
				Math.abs(ctx.ballPos.z) > 12;
			if (attacking && ballDist < 26) return;
		}
		target.set(pad.x, 0, pad.z);
		this.fsmState = "REPOSITION";
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
		const fuel = player.getBoostFuel();
		if (fuel <= 0.04) return;

		const meridian = isMeridianArenaActive();
		if (meridian) {
			const aligned = Math.abs(crossY) <= 0.42;
			if (
				(aligned || distToTarget > 7) &&
				speed < RL_CAR.maxSpeed - 0.2 &&
				fuel > 0.04
			) {
				input.boost = true;
			}
			return;
		}

		/** Niski tank — nie pal przy prawie max throttle speed bez chase. */
		const conserve =
			fuel < 0.22 &&
			!this.chasingLooseBall &&
			speed > RL_CAR.throttleMaxSpeed * 0.88;
		if (conserve) return;

		/** Krytycznie sucho — boost tylko w challenge blisko piłki. */
		if (fuel < 0.14 && distToTarget > 14) return;

		if (this.chasingLooseBall && distToTarget > 5) {
			const looseAligned = Math.abs(crossY) <= 0.34;
			if (looseAligned || distToTarget > 12) {
				input.boost =
					speed < RL_CAR.maxSpeed - 0.35 &&
					fuel > 0.1 &&
					(fuel > 0.2 || distToTarget < 16);
				return;
			}
		}

		const aligned = Math.abs(crossY) <= BOOST_ALIGN_TOLERANCE;
		const minDist = BOOST_MIN_DIST * tuning.boostDistanceMul;
		const biasBoost =
			tuning.boostBias > 0.35 &&
			distToTarget > minDist * 0.65 &&
			fuel > 0.18;
		/** Finish — boost w ostatnie metry (wcześniej minDist=10 gasiło strzał). */
		const finishBoost =
			(this.fsmState === "ALIGN_SHOT" || this.clearanceActive) &&
			aligned &&
			distToTarget < 7 &&
			distToTarget > 0.8 &&
			speed > 4 &&
			fuel > 0.08 &&
			speed < RL_CAR.maxSpeed - 0.25;
		if (
			finishBoost ||
			(aligned &&
				distToTarget > minDist &&
				speed < RL_CAR.maxSpeed - 0.5 &&
				fuel > 0.12) ||
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
		if (this.jumpCooldown > 0 || this.aerialCooldown > 0 || !player.isOnGround())
			return false;
		if (this.fsmState === "AERIAL") return false;
		if (this.flipActionCooldown > 0) return false;

		const defending = ballThreatensOwnGoal(ctx.ballPos, ctx.ballVel, ownGoal);
		const aerialMinY = defending ? 2.35 : 2.55 - tuning.aerialBias * 0.2;
		if (!isBallAirborne(ctx.ballPos, ctx.ballVel, aerialMinY)) return false;
		/** Piłka spada — nie startuj aerial spam. */
		if (!defending && ctx.ballVel.y < -2.5) return false;

		const horizDist = Math.hypot(ctx.ballPos.x - pos.x, ctx.ballPos.z - pos.z);
		const maxDist = defending
			? 5.2 + tuning.aerialBias * 2.4
			: 3.8 + tuning.aerialBias * 2.8;
		if (horizDist > maxDist) return false;

		if (!defending && tuning.aerialBias < 0.42 && role === "goalie") {
			return false;
		}
		/** Ofensywa: wyższy aerialBias — mniej spam. */
		if (!defending && tuning.aerialBias < 0.36) {
			return false;
		}

		if (!defending && player.getBoostFuel() < 0.22) {
			return false;
		}

		this.requestHeuristicJump();
		if (player.getBoostFuel() > 0.04) {
			input.boost = true;
		}
		this.fsmState = "AERIAL";
		this.aerialCooldown = 3.2;
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

		/** Grounded + piłka spada — wyjdź z AERIAL (anty-spam). */
		if (!inAir && ctx.ballVel.y < -1.2 && ballY < pos.y + 2.8) {
			this.fsmState = "ALIGN_SHOT";
			this.aerialCooldown = Math.max(this.aerialCooldown, 1.6);
			return;
		}

		if (fuel > 0.05) {
			if (defending && (ballAbove || horizDist < 14) && fuel > 0.04) {
				input.boost = true;
			} else if (inAir && fuel > 0.08) {
				if (ballAbove && horizDist < 18) {
					input.boost = true;
				}
				if (horizDist > 5 && horizDist < 22 && ballAbove && fuel > 0.12) {
					input.boost = true;
				}
			} else if (ballAbove && horizDist < 10 && fuel > 0.1) {
				input.boost = true;
			}
		}

		if (inAir && horizDist < 6.5 && ballAbove && ballY > 1.1) {
			this.requestHeuristicJump();
		}

		if (inAir && horizDist > 3 && horizDist < 22 && ballAbove) {
			applyVectorSteering(input, this.smoothedTarget, player);
		} else if (horizDist > 14 && tuning.aerialBias > 0.3) {
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
		if (role === "goalie" || ctx.kickoffActive) {
			this.frontFlipPhase = "none";
			return;
		}
		if (this.flipActionCooldown > 0) {
			this.frontFlipPhase = "none";
			return;
		}
		if (ballThreatensOwnGoal(ctx.ballPos, ctx.ballVel, ownGoal, 0.8)) {
			this.frontFlipPhase = "none";
			return;
		}

		const distBall = pos.distanceTo(ctx.ballPos);
		const carSpeed = player.getVelocity().length();
		const enemyGoal = this.attackGoal(ctx);
		const alignedShot = isAlignedForShot(
			pos,
			player.getForward(),
			ctx.ballPos,
			enemyGoal,
			0.4,
		);
		const wantFlip =
			player.isOnGround() &&
			(this.fsmState === "ALIGN_SHOT" || this.clearanceActive) &&
			((distBall > 28 && carSpeed > 8 && !isLooseBall(ctx.ballVel)) ||
				(alignedShot && distBall < 5.5 && distBall > 1.6 && carSpeed > 8.5));

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
			this.flipActionCooldown = FLIP_ACTION_COOLDOWN_SEC;
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

		const distBall = pos.distanceTo(ctx.ballPos);
		/** 50/50 — blisko piłki z rywalem: nie odsuwaj się, walcz o kontakt. */
		const contest =
			distBall < 5.5 &&
			ctx.peers.some(
				(p) =>
					p.slotIndex !== this.slotIndex &&
					p.team !== this.team &&
					p.position.distanceTo(ctx.ballPos) < 5.5,
			);
		if (contest) return;

		/** 2v2 mid-fight — słabszy spread, żeby nie rozwalać linii strzału. */
		const sepRadius = ctx.teamSize <= 2 ? 5.2 : 7;
		const sepPush = ctx.teamSize <= 2 ? 0.35 : 0.55;

		for (const peer of ctx.peers) {
			if (peer.slotIndex === this.slotIndex) continue;
			/** Teammate blisko piłki — nie odsuwaj finishu (2v2 mid-stall). */
			if (
				peer.team === this.team &&
				distBall < 9 &&
				peer.position.distanceTo(ctx.ballPos) < 10
			) {
				continue;
			}
			const sep = pos.distanceTo(peer.position);
			if (sep > sepRadius || sep < 0.01) continue;
			_offset
				.copy(pos)
				.sub(peer.position)
				.normalize()
				.multiplyScalar((sepRadius - sep) * sepPush);
			targetPos.add(_offset);
		}
	}

	/**
	 * Demo avoidance — wróg bardzo blisko: zjedź w bok zamiast brać bump head-on.
	 * (Bez velocity peerów — czysta geometria dystansu.)
	 * Nie stosuj przy piłce / kickoffie / clearance — zabija 2v2 scoring.
	 */
	private applyDemoAvoidance(
		targetPos: THREE.Vector3,
		ctx: BehaviorContext,
		pos: THREE.Vector3,
	): void {
		if (ctx.kickoffActive || this.clearanceActive) return;
		if (this.fsmState === "ALIGN_SHOT" || this.fsmState === "AERIAL") return;
		const distBall = pos.distanceTo(ctx.ballPos);
		if (distBall < 8) return;

		let nearestEnemy: THREE.Vector3 | null = null;
		let nearestDist = 3.2;
		for (const peer of ctx.peers) {
			if (peer.slotIndex === this.slotIndex) continue;
			if (peer.team === this.team) continue;
			const d = pos.distanceTo(peer.position);
			if (d < nearestDist) {
				nearestDist = d;
				nearestEnemy = peer.position;
			}
		}
		if (!nearestEnemy) return;

		_offset.copy(pos).sub(nearestEnemy);
		_offset.y = 0;
		if (_offset.lengthSq() < 0.01) {
			_offset.set(this.slotIndex % 2 === 0 ? 1 : -1, 0, 0);
		} else {
			_offset.normalize();
		}
		/** Lateral preferowany — unikaj cofania od piłki. */
		_shotLine.copy(ctx.ballPos).sub(pos);
		_shotLine.y = 0;
		if (_shotLine.lengthSq() > 0.01) {
			_shotLine.normalize();
			const along = _offset.dot(_shotLine);
			_offset.addScaledVector(_shotLine, -along);
			if (_offset.lengthSq() < 0.01) {
				_offset.set(-_shotLine.z, 0, _shotLine.x);
			} else {
				_offset.normalize();
			}
		}
		const push = THREE.MathUtils.clamp((3.2 - nearestDist) * 1.6, 0.5, 3.2);
		targetPos.addScaledVector(_offset, push);
	}

	private updateClearance(
		role: BotRole,
		ctx: BehaviorContext,
		ownGoal: THREE.Vector3,
	): void {
		const backboard = isBackboardBall(ctx.ballPos, ownGoal);
		/** 1v1 / striker też może clearować backboard — nie tylko goalie. */
		if (role !== "goalie" && !backboard) {
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

		this.clearanceActive =
			backboard || (inOurHalf && (role === "goalie") && velTowardGoal > 2);
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
		if (isMeridianArenaActive()) {
			return meridianHalfTarget(this.team === "orange" ? "blue" : "orange");
		}
		if (ctx.isFFA || !this.team) {
			const toBlue = ctx.ballPos.distanceToSquared(GOAL_BLUE);
			const toOrange = ctx.ballPos.distanceToSquared(GOAL_ORANGE);
			return toBlue < toOrange ? GOAL_BLUE : GOAL_ORANGE;
		}
		return this.team === "blue" ? GOAL_BLUE : GOAL_ORANGE;
	}

	private defendGoal(): THREE.Vector3 {
		if (isMeridianArenaActive()) {
			return meridianHalfTarget(this.team === "blue" ? "blue" : "orange");
		}
		if (this.team === "blue") return GOAL_ORANGE;
		if (this.team === "orange") return GOAL_BLUE;
		return GOAL_ORANGE;
	}
}

/** Punkt głęboko na połowie drużyny (na skorupie) — target possession Meridian. */
function meridianHalfTarget(half: "blue" | "orange"): THREE.Vector3 {
	const R = meridianSphereRadius();
	const zSign = half === "orange" ? 1 : -1;
	/** ~55° od nadiru w stronę bieguna Z — głęboka possession. */
	const fromNadir = 0.95;
	const dirX = 0;
	const dirY = -Math.cos(fromNadir);
	const dirZ = Math.sin(fromNadir) * zSign;
	return _meridianGoal.set(dirX * R * 0.92, R + dirY * R * 0.92, dirZ * R * 0.92);
}
