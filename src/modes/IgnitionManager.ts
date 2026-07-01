import * as THREE from "three";
import type { BotRole } from "../ai/AIManager";
import type { BehaviorContext, BotFsmState } from "../ai/BotBehavior";
import type GameObject from "../GameObject";
import type { CarEntity } from "../game/CarEntity";
import type { ScoringTeam } from "../game/modes";
import type Player from "../util/Player";
import { RL_BALL } from "../util/rlConstants";
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

export const POWER_UP_PICK_INTERVAL_SEC = 10;

const PICK_INTERVAL_SEC = POWER_UP_PICK_INTERVAL_SEC;
const MAGNET_RADIUS = 15;
const MAGNET_FORCE = 180;
const PLUNGER_FORCE = 95;
const PLUNGER_DURATION = 4;
const HAYMAKER_IMPULSE = 28;
const SPIKES_GRAB_RADIUS = 3;
const SPIKES_HOLD_SEC = 5;
const MAGNET_DURATION = 5;

const GOAL_BLUE = new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH);
const GOAL_ORANGE = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);

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

export type IgnitionOptions = {
	/** Boty mogą aktywować power-upy (wyłączone w trybie testowym). */
	botsUsePowerUps?: boolean;
};

export class IgnitionManager {
	private readonly slots = new Map<number, SlotPowerState>();
	private readonly enabled: boolean;
	private readonly botsUsePowerUps: boolean;
	private spikesOwnerSlot: number | null = null;
	private readonly ballRef: { current: GameObject | null } = { current: null };

	constructor(modeIsIgnition: boolean, options: IgnitionOptions = {}) {
		this.enabled = modeIsIgnition;
		this.botsUsePowerUps = options.botsUsePowerUps ?? true;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	registerSlot(slotIndex: number): void {
		if (!this.enabled) return;
		this.slots.set(slotIndex, {
			held: null,
			pickTimer: PICK_INTERVAL_SEC * 0.5 + slotIndex * 0.3,
			activeKind: null,
			activeTimer: 0,
			plungerTimer: 0,
			spikesTimer: 0,
			spikesGrip: false,
		});
	}

	resetAll(): void {
		for (const state of this.slots.values()) {
			state.held = null;
			state.activeKind = null;
			state.activeTimer = 0;
			state.plungerTimer = 0;
			state.spikesTimer = 0;
			state.spikesGrip = false;
			state.pickTimer = PICK_INTERVAL_SEC;
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
				pickSecondsLeft: PICK_INTERVAL_SEC,
				activeKind: null,
				activeProgress: 0,
				activeSecondsLeft: 0,
			};
		}

		const pickSecondsLeft = state.held ? 0 : Math.max(0, state.pickTimer);
		const pickProgress = state.held
			? 1
			: 1 - pickSecondsLeft / PICK_INTERVAL_SEC;

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

	bindBall(ball: GameObject): void {
		this.ballRef.current = ball;
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
				state.pickTimer = PICK_INTERVAL_SEC;
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

		this.applyContinuousForces(cars, ball);
		this.syncSpikesBall(cars, ball);
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
					fsm === "ALIGN_SHOT" &&
					role === "striker" &&
					pos.distanceTo(enemyGoal) < RL_ARENA.HALF_LENGTH * 0.55;
				break;
			case "plunger": {
				_pull.copy(pos).sub(ballPos);
				_pull.y = 0;
				const distBall = _pull.length();
				if (distBall > 0.01) _pull.multiplyScalar(1 / distBall);
				const dotFwdBall = _fwd.dot(_pull);
				_toGoal.copy(enemyGoal).sub(pos);
				_toGoal.y = 0;
				_toGoal.normalize();
				shouldUse =
					dotFwdBall > 0.4 &&
					_fwd.dot(_toGoal) > 0.65 &&
					distBall > 4 &&
					distBall < 18;
				break;
			}
			case "haymaker": {
				_ballToGoal.copy(enemyGoal).sub(ballPos);
				_ballToGoal.y = 0;
				if (_ballToGoal.lengthSq() > 0.01) {
					_ballToGoal.normalize();
					shouldUse =
						role === "striker" &&
						_fwd.dot(_ballToGoal) > 0.88 &&
						pos.distanceTo(ballPos) < 5;
				}
				break;
			}
			case "spikes":
				shouldUse = pos.distanceTo(ballPos) < SPIKES_GRAB_RADIUS;
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
		state.pickTimer = PICK_INTERVAL_SEC;
		state.activeKind = kind;

		const pos = player.getPosition();
		const ballPos = ball.getPosition();

		switch (kind) {
			case "magnet":
				state.activeTimer = MAGNET_DURATION;
				return true;
			case "plunger":
				state.plungerTimer = PLUNGER_DURATION;
				state.activeTimer = PLUNGER_DURATION;
				return true;
			case "haymaker": {
				_fwd.copy(player.getForward());
				_fwd.y = 0;
				if (_fwd.lengthSq() < 0.01) _fwd.set(0, 0, 1);
				_fwd.normalize();
				ball.rapierRigidBody.applyImpulse(
					{
						x: _fwd.x * HAYMAKER_IMPULSE * RL_BALL.mass,
						y: 4 * RL_BALL.mass,
						z: _fwd.z * HAYMAKER_IMPULSE * RL_BALL.mass,
					},
					true,
				);
				state.activeKind = null;
				return true;
			}
			case "spikes":
				if (pos.distanceTo(ballPos) < SPIKES_GRAB_RADIUS) {
					state.spikesGrip = true;
					state.spikesTimer = SPIKES_HOLD_SEC;
					this.spikesOwnerSlot = slotIndex;
				}
				return true;
			default:
				return false;
		}
	}

	private applyContinuousForces(cars: CarEntity[], ball: GameObject): void {
		const ballPos = ball.getPosition();
		const ballBody = ball.rapierRigidBody;

		for (const car of cars) {
			const state = this.slots.get(car.slotIndex);
			if (!state) continue;
			const pos = car.player.getPosition();

			if (state.activeKind === "magnet" && state.activeTimer > 0) {
				const dist = pos.distanceTo(ballPos);
				if (dist < MAGNET_RADIUS && dist > 0.5) {
					_pull.copy(pos).sub(ballPos).normalize();
					const strength = MAGNET_FORCE * (1 - dist / MAGNET_RADIUS);
					ballBody.applyImpulse(
						{
							x: _pull.x * strength * RL_BALL.mass * 0.016,
							y: _pull.y * strength * RL_BALL.mass * 0.008,
							z: _pull.z * strength * RL_BALL.mass * 0.016,
						},
						true,
					);
				}
			}

			if (state.plungerTimer > 0) {
				_fwd.copy(car.player.getForward());
				_fwd.y = 0;
				_fwd.normalize();
				_behind.copy(pos).addScaledVector(_fwd, -2.2);
				const dist = _behind.distanceTo(ballPos);
				if (dist < 12 && dist > 1) {
					_pull.copy(_behind).sub(ballPos).normalize();
					const strength = PLUNGER_FORCE * (1 - dist / 12);
					ballBody.applyImpulse(
						{
							x: _pull.x * strength * RL_BALL.mass * 0.02,
							y: 0,
							z: _pull.z * strength * RL_BALL.mass * 0.02,
						},
						true,
					);
				}
			}
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
}
