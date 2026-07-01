import type * as THREE from "three";
import type { CarEntity } from "../../game/CarEntity";
import type { ScoringTeam } from "../../game/modes";
import type {
	FederatedProgressEntry,
	GlobalPolicyState,
} from "../../net/botPolicyProtocol";
import {
	fetchGlobalBotPolicy,
	getPolicyFederationStats,
	pushGlobalBotPolicy,
} from "../../net/globalBotPolicy";
import type Player from "../../util/Player";
import type { BotRole } from "../AIManager";
import type { BotDrive } from "../BotBehavior";
import {
	type BotProgressSummary,
	getBotProgressLog,
	mergeProgressLogsForReport,
	recordBotProgress,
	summarizeBotProgress,
} from "./BotLearningProgress";
import {
	type BotLearningTuning,
	buildLearnedDriveContext,
	NEUTRAL_TUNING,
	resolveLearnedDrive,
} from "./BotLearningTuning";
import {
	type BotThinkContext,
	buildBotObservation,
	enemyGoalFor,
	jumpHintFromThinkContext,
	type ObservationContext,
} from "./BotObservation";
import { BotPolicy, type BotPolicyData } from "./BotPolicy";
import { evaluateBotStackEpisode } from "./HeadlessBotMatch";

const STORAGE_KEY = "ignite-bot-policy-cache";
const POLICY_URL = "/assets/ai/bot-policy.json";
const ROLLOUT_CAP = 64;
const MICRO_MUTANTS = 5;
const MICRO_EPISODE_SEC = 6;

type StepMemory = {
	obs: Float32Array;
	outputs: Float32Array;
};

type StorageEnvelope = {
	active: BotPolicyData;
	best: BotPolicyData | null;
};

export class BotLearning {
	private static instance: BotLearning | null = null;

	readonly policy: BotPolicy;
	private bestPolicy: BotPolicy | null = null;
	private bestFitness = -Infinity;
	private enabled = true;
	private loaded = false;
	private globalSynced = false;
	private microEvolveRunning = false;
	private globalMatches = 0;
	private globalGoalEvents = 0;
	private federatedProgressLog: FederatedProgressEntry[] = [];
	private sessionReward = 0;
	private lastBotDelta = 0;
	private evalPolicy: BotPolicy | null = null;
	private readonly stepMemory = new Map<number, StepMemory>();
	private readonly rollout = new Map<number, StepMemory[]>();
	private readonly tuningBySlot = new Map<number, BotLearningTuning>();
	private readonly lastDistToBall = new Map<number, number>();
	private readonly lastBallTowardEnemy = new Map<number, number>();
	private readonly lastInAir = new Map<number, boolean>();
	private readonly lastJumped = new Map<number, boolean>();
	private matchAerialTouches = 0;
	private readonly scratchObs = new Float32Array(18);
	private readonly scratchOut = new Float32Array(4);

	private constructor() {
		this.policy = new BotPolicy();
	}

	static get(): BotLearning {
		if (!BotLearning.instance) {
			BotLearning.instance = new BotLearning();
		}
		return BotLearning.instance;
	}

	static resetForTests(): void {
		BotLearning.instance = null;
	}

	get generation(): number {
		return this.policy.generation;
	}

	get fitness(): number {
		return this.policy.fitness;
	}

	isReady(): boolean {
		return this.loaded;
	}

	isGlobal(): boolean {
		return this.globalSynced;
	}

	isFederated(): boolean {
		const stats = getPolicyFederationStats();
		return this.globalSynced && stats.syncTargets > 1;
	}

	getFederationStats() {
		return getPolicyFederationStats();
	}

	isMicroEvolveRunning(): boolean {
		return this.microEvolveRunning;
	}

	getGlobalMatchCount(): number {
		return this.globalMatches;
	}

	getGlobalGoalEvents(): number {
		return this.globalGoalEvents;
	}

	isActive(): boolean {
		if (this.evalPolicy) return true;
		return (
			this.enabled &&
			this.loaded &&
			(this.policy.generation >= 1 || this.policy.fitness > 0.5)
		);
	}

	getTuning(slotIndex: number): BotLearningTuning {
		return this.tuningBySlot.get(slotIndex) ?? NEUTRAL_TUNING;
	}

	get bestFitnessScore(): number {
		return this.bestFitness;
	}

	getProgressSummary(): BotProgressSummary {
		const log = mergeProgressLogsForReport(
			this.federatedProgressLog,
			getBotProgressLog(),
			this.bestFitness,
		);
		return summarizeBotProgress(log, {
			generation: this.policy.generation,
			fitness: this.policy.fitness,
			bestFitness: this.bestFitness,
			globalMatches: this.globalMatches,
			federatedEntries: this.federatedProgressLog.length,
		});
	}

	getInterceptLead(slotIndex: number): number {
		const tuned = this.tuningBySlot.get(slotIndex);
		if (tuned) return tuned.interceptLead;
		return this.getGlobalInterceptLead();
	}

	getGlobalInterceptLead(): number {
		if (!this.isActive()) return 1;
		return Math.min(
			1.5,
			0.9 +
				this.policy.generation * 0.016 +
				Math.max(0, this.policy.fitness) * 0.0028,
		);
	}

	withEvalPolicy<T>(policy: BotPolicy, fn: () => T): T {
		this.evalPolicy = policy;
		this.clearStepTracking();
		try {
			return fn();
		} finally {
			this.evalPolicy = null;
			this.clearStepTracking();
		}
	}

	async init(): Promise<void> {
		if (this.loaded) return;

		const global = await fetchGlobalBotPolicy();
		if (global) {
			this.applyGlobalState(global);
			this.globalSynced = true;
			this.loaded = true;
			this.cacheLocal();
			return;
		}

		const cached = this.loadCache();
		if (cached) {
			this.applyEnvelope(cached);
			this.loaded = true;
			return;
		}

		try {
			const res = await fetch(POLICY_URL, { cache: "no-store" });
			if (res.ok) {
				const data = (await res.json()) as BotPolicyData;
				this.replacePolicy(BotPolicy.fromData(data));
				this.bestPolicy = this.policy.clone();
				this.bestFitness = this.policy.fitness;
				this.cacheLocal();
			}
		} catch {
			// start od zera
		}

		this.loaded = true;
	}

	async refreshFromGlobal(): Promise<boolean> {
		const global = await fetchGlobalBotPolicy();
		if (!global) return false;
		this.applyGlobalState(global);
		this.globalSynced = true;
		this.loaded = true;
		this.cacheLocal();
		return true;
	}

	think(
		slotIndex: number,
		player: Player,
		_role: BotRole,
		ctx: BotThinkContext,
		heuristic: BotDrive,
	): BotDrive {
		if (!this.enabled) return heuristic;

		const pol = this.activePolicy();
		buildBotObservation(player, ctx, this.scratchObs);
		pol.predict(this.scratchObs, this.scratchOut);

		const active = this.isActive();
		const learnedCtx = buildLearnedDriveContext(
			player,
			jumpHintFromThinkContext(ctx),
			this.scratchOut,
			pol.generation,
			pol.fitness,
			active,
		);
		this.tuningBySlot.set(slotIndex, learnedCtx.tuning);

		const step: StepMemory = {
			obs: this.scratchObs.slice(),
			outputs: this.scratchOut.slice(),
		};
		this.stepMemory.set(slotIndex, step);
		this.pushRollout(slotIndex, step);

		const stepReward = this.computeStepReward(slotIndex, player, ctx);
		if (!this.evalPolicy && Math.abs(stepReward) > 1e-5) {
			this.reinforceRollout(slotIndex, stepReward, 0.07);
		}

		if (!active) {
			const fallback = resolveLearnedDrive(heuristic, {
				...learnedCtx,
				maturity: 0.28,
			});
			this.lastJumped.set(slotIndex, fallback.jump === true);
			return fallback;
		}

		const drive = resolveLearnedDrive(heuristic, learnedCtx);
		this.lastJumped.set(slotIndex, drive.jump === true);
		return drive;
	}

	onGoal(scoringTeam: ScoringTeam, cars: CarEntity[]): void {
		if (!this.enabled) return;

		for (const car of cars) {
			if (car.isHuman) continue;
			const reward = car.team === scoringTeam ? 3.4 : -2.4;
			this.reinforceRollout(car.slotIndex, reward, 0.12);
			this.sessionReward += reward;
		}

		if (this.sessionReward > 0) {
			this.policy.fitness += 1.2;
		}
		this.maybePromoteBest();
		void this.persist("goal");
	}

	onMatchEnd(blueScore: number, orangeScore: number, cars: CarEntity[]): void {
		if (!this.enabled) return;

		const bots = cars.filter((c) => !c.isHuman);
		if (bots.length === 0) return;

		let botDelta = 0;
		for (const car of bots) {
			if (car.team === "blue") botDelta += blueScore - orangeScore;
			else if (car.team === "orange") botDelta += orangeScore - blueScore;
		}
		botDelta /= bots.length;
		this.lastBotDelta = botDelta;

		this.policy.fitness = this.policy.fitness * 0.72 + botDelta * 5.5;

		if (botDelta > 0) {
			for (const car of bots) {
				this.reinforceRollout(car.slotIndex, botDelta * 1.1, 0.1);
			}
			this.policy.mutate(0.035);
		} else if (botDelta < 0) {
			this.policy.mutate(0.09);
			if (botDelta <= -2 && this.bestPolicy) {
				this.policy.copyFrom(this.bestPolicy);
				this.policy.mutate(0.05);
			}
		} else {
			this.policy.mutate(0.03);
		}

		this.policy.generation += 1;
		this.sessionReward = 0;
		this.recordMatchProgress(botDelta);
		const aerialTouches = this.matchAerialTouches;
		this.matchAerialTouches = 0;
		this.clearStepTracking();
		this.tuningBySlot.clear();
		this.maybePromoteBest();
		void this.persist("match_end", botDelta, aerialTouches);
		void this.microEvolveAfterMatch();
	}

	/** Headless ewolucja po meczu — mutacje oceniane na pełnym stacku BotBehavior. */
	async microEvolveAfterMatch(): Promise<boolean> {
		if (
			!this.enabled ||
			!this.loaded ||
			this.microEvolveRunning ||
			import.meta.env.VITEST
		) {
			return false;
		}

		this.microEvolveRunning = true;
		try {
			const baseline = this.policy.clone();
			let best = baseline;
			let bestFit = -Infinity;

			const baselineResult = await evaluateBotStackEpisode(
				baseline,
				MICRO_EPISODE_SEC,
				Date.now(),
			);
			bestFit = baselineResult.fitness;

			for (let i = 0; i < MICRO_MUTANTS; i++) {
				const mutant = baseline.clone();
				mutant.mutate(0.11 + i * 0.02);
				const result = await evaluateBotStackEpisode(
					mutant,
					MICRO_EPISODE_SEC,
					Date.now() + i * 997,
				);
				if (result.fitness > bestFit) {
					bestFit = result.fitness;
					best = mutant;
				}
			}

			if (bestFit > baselineResult.fitness + 1.5) {
				best.fitness = bestFit;
				best.generation = this.policy.generation + 1;
				this.replacePolicy(best);
				this.maybePromoteBest();
				this.cacheLocal();
				this.recordMicroProgress(bestFit, baselineResult.fitness);
				await this.persist("match_end", this.lastBotDelta);
				if (import.meta.env.DEV) {
					console.info(
						`[BotLearning] micro-evolve promoted fitness ${baselineResult.fitness.toFixed(1)} → ${bestFit.toFixed(1)}`,
					);
				}
				return true;
			}
			return false;
		} catch (err) {
			if (import.meta.env.DEV) {
				console.warn("[BotLearning] micro-evolve skipped", err);
			}
			return false;
		} finally {
			this.microEvolveRunning = false;
		}
	}

	exportData(): BotPolicyData {
		return this.policy.toData();
	}

	loadPolicyData(data: BotPolicyData): void {
		this.replacePolicy(BotPolicy.fromData(data));
		this.bestPolicy = this.policy.clone();
		this.bestFitness = this.policy.fitness;
		this.loaded = true;
		this.cacheLocal();
	}

	private activePolicy(): BotPolicy {
		return this.evalPolicy ?? this.policy;
	}

	private computeStepReward(
		slotIndex: number,
		player: Player,
		ctx: ObservationContext,
	): number {
		const pos = player.getPosition();
		const dist = pos.distanceTo(ctx.ballPos);
		const lastDist = this.lastDistToBall.get(slotIndex);
		this.lastDistToBall.set(slotIndex, dist);

		const inAir = !player.isOnGround();
		const wasInAir = this.lastInAir.get(slotIndex) ?? false;
		this.lastInAir.set(slotIndex, inAir);

		let reward = 0;
		if (lastDist !== undefined) {
			const closing = lastDist - dist;
			if (closing > 0.05) reward += 0.06;
			else if (closing < -0.1) reward -= 0.025;
		}

		if (lastDist !== undefined && lastDist >= 2.4 && dist < 2.2) {
			reward += 0.22;
			if (ctx.ballPos.y > 1.35) {
				reward += 0.38;
				this.matchAerialTouches++;
			}
		}

		if (inAir && ctx.ballPos.y > 1.25 && dist < 3.5) {
			reward += 0.04;
		}
		if (inAir && !wasInAir && ctx.ballPos.y > 1.6) {
			reward += 0.08;
		}

		const wastedJump = this.lastJumped.get(slotIndex) === true;
		if (wastedJump && ctx.ballPos.y < 0.95 && dist > 2.5) {
			reward -= 0.16;
		}
		if (wastedJump && inAir && ctx.ballPos.y < 1.05 && dist > 4) {
			reward -= 0.1;
		}

		if (ctx.team && dist < 10) {
			const enemyGoal = enemyGoalFor(ctx.team, ctx.ballPos, ctx.isFFA);
			const toward = this.ballVelTowardGoal(
				ctx.ballPos,
				ctx.ballVel,
				enemyGoal,
			);
			const lastToward = this.lastBallTowardEnemy.get(slotIndex) ?? toward;
			if (toward > lastToward + 0.35) reward += 0.05;
			this.lastBallTowardEnemy.set(slotIndex, toward);
		}

		return reward;
	}

	private recordMatchProgress(botDelta: number): void {
		recordBotProgress({
			ts: Date.now(),
			generation: this.policy.generation,
			fitness: this.policy.fitness,
			bestFitness: this.bestFitness,
			botDelta,
			aerialTouches: this.matchAerialTouches,
			microEvolved: false,
			source: "match",
		});
	}

	private recordMicroProgress(newFit: number, _oldFit: number): void {
		recordBotProgress({
			ts: Date.now(),
			generation: this.policy.generation,
			fitness: newFit,
			bestFitness: this.bestFitness,
			botDelta: 0,
			aerialTouches: 0,
			microEvolved: true,
			source: "micro",
		});
	}

	private ballVelTowardGoal(
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		goal: THREE.Vector3,
	): number {
		const gx = goal.x - ballPos.x;
		const gz = goal.z - ballPos.z;
		const len = Math.hypot(gx, gz);
		if (len < 1e-4) return 0;
		return (ballVel.x * gx + ballVel.z * gz) / len;
	}

	private async persist(
		reason: "goal" | "match_end",
		botDelta?: number,
		aerialTouches?: number,
	): Promise<void> {
		try {
			this.cacheLocal();
			const envelope: StorageEnvelope = {
				active: this.policy.toData(),
				best: this.bestPolicy?.toData() ?? null,
			};
			const state = await pushGlobalBotPolicy(
				envelope,
				reason,
				botDelta ?? this.lastBotDelta,
				aerialTouches,
			);
			if (state) {
				this.applyGlobalState(state);
				this.globalSynced = true;
				this.cacheLocal();
			}
		} catch {
			// serwer globalny offline — zostaje cache lokalny
		}
	}

	private applyGlobalState(state: GlobalPolicyState): void {
		this.replacePolicy(BotPolicy.fromData(state.active));
		if (state.best) {
			this.bestPolicy = BotPolicy.fromData(state.best);
			this.bestFitness = state.best.fitness;
		} else {
			this.bestPolicy = this.policy.clone();
			this.bestFitness = this.policy.fitness;
		}
		this.globalMatches = state.totalMatches;
		this.globalGoalEvents = state.totalGoalEvents;
		this.federatedProgressLog = state.progressLog ?? [];
	}

	private pushRollout(slotIndex: number, step: StepMemory): void {
		const buf = this.rollout.get(slotIndex) ?? [];
		buf.push(step);
		if (buf.length > ROLLOUT_CAP) buf.shift();
		this.rollout.set(slotIndex, buf);
	}

	private reinforceRollout(
		slotIndex: number,
		reward: number,
		learningRate: number,
	): void {
		const buf = this.rollout.get(slotIndex);
		const pol = this.activePolicy();
		if (!buf || buf.length === 0) {
			this.applyReward(slotIndex, reward, learningRate, pol);
			return;
		}

		let decay = 1;
		for (let i = buf.length - 1; i >= 0; i--) {
			const step = buf[i]!;
			pol.reinforce(step.obs, step.outputs, reward * decay, learningRate);
			decay *= 0.93;
		}
	}

	private applyReward(
		slotIndex: number,
		reward: number,
		learningRate: number,
		pol: BotPolicy,
	): void {
		const mem = this.stepMemory.get(slotIndex);
		if (!mem) return;
		pol.reinforce(mem.obs, mem.outputs, reward, learningRate);
	}

	private maybePromoteBest(): void {
		if (this.policy.fitness > this.bestFitness) {
			this.bestFitness = this.policy.fitness;
			this.bestPolicy = this.policy.clone();
		}
	}

	private replacePolicy(next: BotPolicy): void {
		this.policy.copyFrom(next);
	}

	private applyEnvelope(envelope: StorageEnvelope): void {
		this.replacePolicy(BotPolicy.fromData(envelope.active));
		if (envelope.best) {
			this.bestPolicy = BotPolicy.fromData(envelope.best);
			this.bestFitness = envelope.best.fitness;
		} else {
			this.bestPolicy = this.policy.clone();
			this.bestFitness = this.policy.fitness;
		}
	}

	private clearStepTracking(): void {
		this.stepMemory.clear();
		this.rollout.clear();
		this.lastDistToBall.clear();
		this.lastBallTowardEnemy.clear();
		this.lastInAir.clear();
		this.lastJumped.clear();
	}

	private loadCache(): StorageEnvelope | null {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as StorageEnvelope | BotPolicyData;
			if ("active" in parsed) return parsed;
			return { active: parsed, best: null };
		} catch {
			return null;
		}
	}

	private cacheLocal(): void {
		try {
			const envelope: StorageEnvelope = {
				active: this.policy.toData(),
				best: this.bestPolicy?.toData() ?? null,
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
		} catch {
			// ignore
		}
	}
}
