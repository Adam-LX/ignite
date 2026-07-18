import * as THREE from "three";
import type { BotRole } from "../ai/AIManager";
import type { BehaviorContext, BotFsmState } from "../ai/BotBehavior";
import { ballThreatensOwnGoal, isLooseBall } from "../ai/botTactics";
import type GameObject from "../GameObject";
import type { CarEntity } from "../game/CarEntity";
import type { ScoringTeam } from "../game/modes";
import type Player from "../util/Player";
import { RL_BALL, RL_CAR } from "../util/rlConstants";
import { RL_ARENA } from "../visual/arenaConstants";

export type PowerUpKind = "magnet" | "plunger" | "haymaker" | "spikes";

export type PowerUpHudState = {
	enabled: boolean;
	held: PowerUpKind | null;
	/** 0–1 — ładowanie do następnego losowania (gdy brak held). */
	pickProgress: number;
	pickSecondsLeft: number;
	activeKind: PowerUpKind | null;
	/** 0–1 — pozostały czas aktywnego efektu. */
	activeProgress: number;
	/** Sekundy do końca aktywnego efektu (do timera HUD / VFX). */
	activeSecondsLeft: number;
};

export const POWER_UP_PICK_INTERVAL_BASE_SEC = 13;
export const POWER_UP_PICK_INTERVAL_PER_PLAYER_SEC = 0.5;

/** Cooldown po zużyciu power-upu — rośnie z liczbą slotów (Gemini M3 balans). */
export function ignitionPickIntervalSec(slotCount: number): number {
	const n = Math.max(1, slotCount);
	return (
		POWER_UP_PICK_INTERVAL_BASE_SEC + POWER_UP_PICK_INTERVAL_PER_PLAYER_SEC * n
	);
}

/** Eksport do testów / HUD — nie zmieniaj bez regresji w `tests/modes/`. */
export const IGNITION_BALANCE = {
	pickIntervalBaseSec: POWER_UP_PICK_INTERVAL_BASE_SEC,
	pickIntervalPerPlayerSec: POWER_UP_PICK_INTERVAL_PER_PLAYER_SEC,
	magnetDurationSec: 5,
	plungerDurationSec: 4,
	spikesHoldSec: 4,
	spikesGrabRadius: 3,
	/** Magnet: pełna siła poniżej tej odległości (m). */
	magnetNearFullDistM: 2,
	/** Magnet: min. siła (× bazowej) powyżej tej odległości (m). */
	magnetFarDistM: 8,
	magnetFarForceFactor: 0.3,
	/** Spikes: rozłącz grip gdy auto szybsze niż factor × RL_CAR.maxSpeed. */
	spikesSpeedBreakFactor: 1.5,
} as const;

const PLUNGER_FORCE = 95;
const PLUNGER_DURATION = IGNITION_BALANCE.plungerDurationSec;
const HAYMAKER_IMPULSE = 28;
const SPIKES_GRAB_RADIUS = IGNITION_BALANCE.spikesGrabRadius;
const SPIKES_HOLD_SEC = IGNITION_BALANCE.spikesHoldSec;
const MAGNET_DURATION = IGNITION_BALANCE.magnetDurationSec;

const GOAL_BLUE = new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH);
const GOAL_ORANGE = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);

/** RL Magnetizer — zasięg przyciągania (studnia grawitacji wokół auta). */
const MAGNET_RADIUS = 18;
const MAGNET_MIN_DIST = 0.85;
/** Siła bazowa — skalowana kwadratem bliskości (mocniej bliżej auta). */
const MAGNET_PULL_PEAK = 520;
/** Słabnie przy szybkiej piłce (RL: nie łap szybkich strzałów). */
const MAGNET_BALL_SPEED_SOFT_CAP = 38;

function magnetDistanceForceFactor(dist: number): number {
	const near = IGNITION_BALANCE.magnetNearFullDistM;
	const far = IGNITION_BALANCE.magnetFarDistM;
	const minF = IGNITION_BALANCE.magnetFarForceFactor;
	if (dist <= near) return 1;
	if (dist >= far) return minF;
	const t = (dist - near) / (far - near);
	return 1 - t * (1 - minF);
}

const POWER_UPS: PowerUpKind[] = ["magnet", "plunger", "haymaker", "spikes"];

type SlotPowerState = {
	held: PowerUpKind | null;
	pickTimer: number;
	activeKind: PowerUpKind | null;
	activeTimer: number;
	plungerTimer: number;
	spikesTimer: number;
	spikesGrip: boolean;
};

const _pull = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _toGoal = new THREE.Vector3();
const _ballToGoal = new THREE.Vector3();
const _behind = new THREE.Vector3();
const _roof = new THREE.Vector3();
const _up = new THREE.Vector3();
const _ballVel = new THREE.Vector3();

export type IgnitionOptions = {
	/** Boty mogą aktywować power-upy (wyłączone w Ignition Test). */
	botsUsePowerUps?: boolean;
};

export type PowerUpActivateEvent = {
	slotIndex: number;
	kind: PowerUpKind;
	position: THREE.Vector3;
	forward: THREE.Vector3;
};

export class IgnitionManager {
	private readonly slots = new Map<number, SlotPowerState>();
	private readonly enabled: boolean;
	private readonly botsUsePowerUps: boolean;
	private spikesOwnerSlot: number | null = null;
	private readonly ballRef: { current: GameObject | null } = { current: null };
	private readonly activateListeners = new Set<
		(event: PowerUpActivateEvent) => void
	>();

	constructor(modeIsIgnition: boolean, options: IgnitionOptions = {}) {
		this.enabled = modeIsIgnition;
		this.botsUsePowerUps = options.botsUsePowerUps ?? true;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	private pickIntervalSec(): number {
		return ignitionPickIntervalSec(this.slots.size);
	}

	registerSlot(slotIndex: number): void {
		if (!this.enabled) return;
		// Indywidualny offset — gracze nie dostają power-upu w tej samej klatce.
		const stagger =
			slotIndex * 2.35 + (slotIndex % 3) * 0.7 + Math.random() * 1.8;
		this.slots.set(slotIndex, {
			held: null,
			pickTimer: this.pickIntervalSec() * 0.45 + stagger,
			activeKind: null,
			activeTimer: 0,
			plungerTimer: 0,
			spikesTimer: 0,
			spikesGrip: false,
		});
	}

	resetAll(): void {
		for (const [slotIndex, state] of this.slots.entries()) {
			state.held = null;
			state.activeKind = null;
			state.activeTimer = 0;
			state.plungerTimer = 0;
			state.spikesTimer = 0;
			state.spikesGrip = false;
			state.pickTimer =
				this.pickIntervalSec() * 0.55 + slotIndex * 1.9 + Math.random() * 1.2;
		}
		this.spikesOwnerSlot = null;
	}

	getHeldPowerUp(slotIndex: number): PowerUpKind | null {
		return this.slots.get(slotIndex)?.held ?? null;
	}

	getHudState(slotIndex: number): PowerUpHudState {
		if (!this.enabled) {
			return {
				enabled: false,
				held: null,
				pickProgress: 0,
				pickSecondsLeft: 0,
				activeKind: null,
				activeProgress: 0,
				activeSecondsLeft: 0,
			};
		}
		const state = this.slots.get(slotIndex);
		if (!state) {
			return {
				enabled: true,
				held: null,
				pickProgress: 0,
				pickSecondsLeft: this.pickIntervalSec(),
				activeKind: null,
				activeProgress: 0,
				activeSecondsLeft: 0,
			};
		}

		const interval = this.pickIntervalSec();
		const pickSecondsLeft = state.held ? 0 : Math.max(0, state.pickTimer);
		const pickProgress = state.held ? 1 : 1 - pickSecondsLeft / interval;

		let activeKind: PowerUpKind | null = state.activeKind;
		let activeProgress = 0;
		let activeSecondsLeft = 0;
		if (state.activeKind === "magnet" && state.activeTimer > 0) {
			activeProgress = state.activeTimer / MAGNET_DURATION;
			activeSecondsLeft = state.activeTimer;
		} else if (state.plungerTimer > 0) {
			activeProgress = state.plungerTimer / PLUNGER_DURATION;
			activeSecondsLeft = state.plungerTimer;
		} else if (state.spikesGrip || state.spikesTimer > 0) {
			activeKind = "spikes";
			activeProgress = state.spikesTimer / SPIKES_HOLD_SEC;
			activeSecondsLeft = state.spikesTimer;
		} else {
			activeKind = null;
		}

		return {
			enabled: true,
			held: state.held,
			pickProgress,
			pickSecondsLeft,
			activeKind,
			activeProgress,
			activeSecondsLeft,
		};
	}

	hasPowerUpEngaged(slotIndex: number): boolean {
		const state = this.slots.get(slotIndex);
		if (!state) return false;
		return state.held !== null || state.activeKind !== null || state.spikesGrip;
	}

	hasSpikesGrip(slotIndex: number): boolean {
		return this.slots.get(slotIndex)?.spikesGrip === true;
	}

	/** Test hook — wymusza held bez czekania na timer losowania. */
	forceHeldForTests(slotIndex: number, kind: PowerUpKind): void {
		const state = this.slots.get(slotIndex);
		if (!state) return;
		state.held = kind;
		state.pickTimer = this.pickIntervalSec();
	}

	bindBall(ball: GameObject): void {
		this.ballRef.current = ball;
	}

	/** VFX / audio — wywoływane po udanej aktywacji power-upu. */
	onActivate(listener: (event: PowerUpActivateEvent) => void): () => void {
		this.activateListeners.add(listener);
		return () => this.activateListeners.delete(listener);
	}

	private notifyActivate(event: PowerUpActivateEvent): void {
		for (const listener of this.activateListeners) listener(event);
	}

	update(
		dt: number,
		cars: CarEntity[],
		ball: GameObject,
		frozen: boolean,
	): void {
		if (!this.enabled || frozen) return;
		this.ballRef.current = ball;

		for (const car of cars) {
			const state = this.slots.get(car.slotIndex);
			if (!state) continue;

			state.pickTimer -= dt;
			if (state.pickTimer <= 0 && !state.held) {
				state.held = POWER_UPS[Math.floor(Math.random() * POWER_UPS.length)]!;
				state.pickTimer = this.pickIntervalSec();
			}

			if (state.activeTimer > 0) {
				state.activeTimer -= dt;
				if (state.activeTimer <= 0) state.activeKind = null;
			}
			if (state.plungerTimer > 0) state.plungerTimer -= dt;
			if (state.spikesTimer > 0) {
				state.spikesTimer -= dt;
				if (state.spikesTimer <= 0) {
					state.spikesGrip = false;
					if (this.spikesOwnerSlot === car.slotIndex)
						this.spikesOwnerSlot = null;
				}
			}
		}

		this.applyContinuousForces(cars, ball, dt);
		this.syncSpikesBall(cars, ball);
		this.checkSpikesSpeedBreak(cars);
	}

	tryBotActivate(
		slotIndex: number,
		player: Player,
		team: ScoringTeam | null,
		role: BotRole,
		fsm: BotFsmState,
		ctx: BehaviorContext,
	): boolean {
		if (!this.enabled || !this.botsUsePowerUps) return false;
		const state = this.slots.get(slotIndex);
		if (!state?.held) return false;

		const ball = this.ballRef.current;
		if (!ball) return false;

		const pos = player.getPosition();
		const ballPos = ctx.ballPos;
		const enemyGoal = this.enemyGoalForTeam(team, ctx.isFFA, pos);
		_fwd.copy(player.getForward());
		_fwd.y = 0;
		_fwd.normalize();

		let shouldUse = false;

		switch (state.held) {
			case "magnet":
				shouldUse =
					(fsm === "ALIGN_SHOT" &&
						role === "striker" &&
						pos.distanceTo(enemyGoal) < RL_ARENA.HALF_LENGTH * 0.6) ||
					(isLooseBall(ctx.ballVel) &&
						pos.distanceTo(ballPos) < 18 &&
						pos.distanceTo(enemyGoal) < RL_ARENA.HALF_LENGTH * 0.78);
				break;
			case "plunger": {
				_pull.copy(pos).sub(ballPos);
				_pull.y = 0;
				const distBall = _pull.length();
				if (distBall > 0.01) _pull.multiplyScalar(1 / distBall);
				const dotFwdBall = _fwd.dot(_pull);

				const ownGoal = this.ownGoalForTeam(team, ctx.isFFA, pos);
				const defending = ballThreatensOwnGoal(
					ballPos,
					ctx.ballVel,
					ownGoal,
					0.45,
				);

				if (defending) {
					_toGoal.copy(ownGoal).sub(ballPos);
					_toGoal.y = 0;
					if (_toGoal.lengthSq() > 0.01) _toGoal.normalize();
					_behind.copy(ballPos).addScaledVector(_toGoal, -2.8);
					const behindDist = pos.distanceTo(_behind);
					shouldUse = distBall > 2.2 && distBall < 16 && behindDist < 9;
				} else {
					_toGoal.copy(enemyGoal).sub(pos);
					_toGoal.y = 0;
					_toGoal.normalize();
					shouldUse =
						dotFwdBall > 0.3 &&
						_fwd.dot(_toGoal) > 0.55 &&
						distBall > 3 &&
						distBall < 18;
				}
				break;
			}
			case "haymaker": {
				_ballToGoal.copy(enemyGoal).sub(ballPos);
				_ballToGoal.y = 0;
				if (_ballToGoal.lengthSq() > 0.01) {
					_ballToGoal.normalize();
					shouldUse =
						role === "striker" &&
						_fwd.dot(_ballToGoal) > 0.8 &&
						pos.distanceTo(ballPos) < 5.5;
				}
				break;
			}
			case "spikes":
				shouldUse =
					pos.distanceTo(ballPos) < SPIKES_GRAB_RADIUS ||
					(role === "striker" &&
						pos.distanceTo(ballPos) < SPIKES_GRAB_RADIUS + 1.2 &&
						pos.distanceTo(enemyGoal) < RL_ARENA.HALF_LENGTH * 0.45);
				break;
		}

		if (!shouldUse) return false;
		return this.consumeAndActivate(slotIndex, player, team, ctx.isFFA, ball);
	}

	tryHumanActivate(
		slotIndex: number,
		player: Player,
		team: ScoringTeam | null,
		isFFA: boolean,
	): boolean {
		if (!this.enabled) return false;
		const state = this.slots.get(slotIndex);
		if (!state?.held) return false;
		const ball = this.ballRef.current;
		if (!ball) return false;
		return this.consumeAndActivate(slotIndex, player, team, isFFA, ball);
	}

	private consumeAndActivate(
		slotIndex: number,
		player: Player,
		_team: ScoringTeam | null,
		_isFFA: boolean,
		ball: GameObject,
	): boolean {
		const state = this.slots.get(slotIndex);
		if (!state?.held) return false;

		const kind = state.held;
		state.held = null;
		state.pickTimer = this.pickIntervalSec();
		state.activeKind = kind;

		const pos = player.getPosition();
		const ballPos = ball.getPosition();

		this.magnetAnchor(player, _roof);
		_fwd.copy(player.getForward());
		_fwd.y = 0;
		if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
		else _fwd.normalize();

		const emitActivation = () => {
			this.notifyActivate({
				slotIndex,
				kind,
				position: _roof.clone(),
				forward: _fwd.clone(),
			});
		};

		switch (kind) {
			case "magnet":
				state.activeTimer = MAGNET_DURATION;
				emitActivation();
				return true;
			case "plunger":
				state.plungerTimer = PLUNGER_DURATION;
				state.activeTimer = PLUNGER_DURATION;
				emitActivation();
				return true;
			case "haymaker": {
				ball.rapierRigidBody.applyImpulse(
					{
						x: _fwd.x * HAYMAKER_IMPULSE * RL_BALL.mass,
						y: 4 * RL_BALL.mass,
						z: _fwd.z * HAYMAKER_IMPULSE * RL_BALL.mass,
					},
					true,
				);
				state.activeKind = null;
				emitActivation();
				return true;
			}
			case "spikes":
				if (pos.distanceTo(ballPos) < SPIKES_GRAB_RADIUS) {
					state.spikesGrip = true;
					state.spikesTimer = SPIKES_HOLD_SEC;
					this.spikesOwnerSlot = slotIndex;
					emitActivation();
					return true;
				}
				/** Miss — nie konsumuj picka, nie zostawiaj stuck activeKind. */
				state.held = kind;
				state.activeKind = null;
				state.pickTimer = 0;
				return false;
			default:
				return false;
		}
	}

	private magnetAnchor(player: Player, out: THREE.Vector3): THREE.Vector3 {
		out.copy(player.getPosition());
		_fwd.copy(player.getForward());
		_fwd.y = 0;
		if (_fwd.lengthSq() > 1e-6) _fwd.normalize();
		else _fwd.set(0, 0, 1);
		return out
			.addScaledVector(_fwd, 0.55)
			.addScaledVector(player.getUpward(), 0.42);
	}

	private applyContinuousForces(
		cars: CarEntity[],
		ball: GameObject,
		dt: number,
	): void {
		const ballPos = ball.getPosition();
		const ballBody = ball.rapierRigidBody;
		const linvel = ballBody.linvel();
		_ballVel.set(linvel.x, linvel.y, linvel.z);
		const ballSpeed = _ballVel.length();

		for (const car of cars) {
			const state = this.slots.get(car.slotIndex);
			if (!state) continue;

			if (state.activeKind === "magnet" && state.activeTimer > 0) {
				this.magnetAnchor(car.player, _roof);
				_pull.copy(_roof).sub(ballPos);
				const dist = _pull.length();
				if (dist < MAGNET_RADIUS && dist > MAGNET_MIN_DIST) {
					_pull.multiplyScalar(1 / dist);
					const closeness = 1 - dist / MAGNET_RADIUS;
					const proximity = closeness * closeness;
					const speedFactor = Math.max(
						0.12,
						1 - ballSpeed / MAGNET_BALL_SPEED_SOFT_CAP,
					);
					const distFactor = magnetDistanceForceFactor(dist);
					const strength =
						MAGNET_PULL_PEAK * proximity * speedFactor * distFactor * dt;
					ballBody.applyImpulse(
						{
							x: _pull.x * strength * RL_BALL.mass,
							y: _pull.y * strength * RL_BALL.mass * 0.55,
							z: _pull.z * strength * RL_BALL.mass,
						},
						true,
					);
				}
			}

			if (state.plungerTimer > 0) {
				const pos = car.player.getPosition();
				_fwd.copy(car.player.getForward());
				_fwd.y = 0;
				_fwd.normalize();
				_behind.copy(pos).addScaledVector(_fwd, -2.2);
				const dist = _behind.distanceTo(ballPos);
				if (dist < 12 && dist > 1) {
					_pull.copy(_behind).sub(ballPos).normalize();
					const strength = PLUNGER_FORCE * (1 - dist / 12) * dt;
					ballBody.applyImpulse(
						{
							x: _pull.x * strength * RL_BALL.mass,
							y: 0,
							z: _pull.z * strength * RL_BALL.mass,
						},
						true,
					);
				}
			}
		}
	}

	private checkSpikesSpeedBreak(cars: CarEntity[]): void {
		if (this.spikesOwnerSlot === null) return;
		const car = cars.find((c) => c.slotIndex === this.spikesOwnerSlot);
		const state = this.slots.get(this.spikesOwnerSlot);
		if (!car || !state?.spikesGrip) return;

		const lv = car.player.rapierRigidBody.linvel();
		const speed = Math.hypot(lv.x, lv.z);
		const cap = RL_CAR.maxSpeed * IGNITION_BALANCE.spikesSpeedBreakFactor;
		if (speed > cap) {
			state.spikesGrip = false;
			state.spikesTimer = 0;
			state.activeKind = null;
			this.spikesOwnerSlot = null;
		}
	}

	private syncSpikesBall(cars: CarEntity[], ball: GameObject): void {
		if (this.spikesOwnerSlot === null) return;
		const car = cars.find((c) => c.slotIndex === this.spikesOwnerSlot);
		const state = this.slots.get(this.spikesOwnerSlot);
		if (!car || !state?.spikesGrip) return;

		const pos = car.player.getPosition();
		_up.copy(car.player.getUpward());
		_fwd.copy(car.player.getForward());
		_roof.copy(pos).addScaledVector(_up, 1.1).addScaledVector(_fwd, 0.2);
		ball.rapierRigidBody.setTranslation(
			{ x: _roof.x, y: _roof.y, z: _roof.z },
			true,
		);
		ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		ball.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
	}

	private enemyGoalForTeam(
		team: ScoringTeam | null,
		isFFA: boolean,
		pos: THREE.Vector3,
	): THREE.Vector3 {
		if (isFFA || !team) {
			return pos.distanceToSquared(GOAL_BLUE) >
				pos.distanceToSquared(GOAL_ORANGE)
				? GOAL_BLUE
				: GOAL_ORANGE;
		}
		return team === "blue" ? GOAL_BLUE : GOAL_ORANGE;
	}

	private ownGoalForTeam(
		team: ScoringTeam | null,
		isFFA: boolean,
		pos: THREE.Vector3,
	): THREE.Vector3 {
		if (isFFA || !team) {
			return pos.distanceToSquared(GOAL_BLUE) <
				pos.distanceToSquared(GOAL_ORANGE)
				? GOAL_BLUE
				: GOAL_ORANGE;
		}
		return team === "blue" ? GOAL_ORANGE : GOAL_BLUE;
	}
}
