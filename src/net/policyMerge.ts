import type { BotPolicyData } from "../ai/learning/BotPolicy";
import {
	type FederatedProgressEntry,
	type GlobalPolicyEnvelope,
	type GlobalPolicyState,
	POLICY_MERGE_ALPHA,
	type PolicySyncPayload,
	type PolicySyncReason,
} from "./botPolicyProtocol";

export const FEDERATED_PROGRESS_CAP = 96;

export function wrapSeedPolicy(data: BotPolicyData): GlobalPolicyState {
	return {
		active: structuredClone(data),
		best: structuredClone(data),
		totalMatches: 0,
		totalGoalEvents: 0,
		totalSyncs: 0,
		updatedAt: new Date(0).toISOString(),
		progressLog: [],
	};
}

export function normalizePolicyState(raw: unknown): GlobalPolicyState | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	if (
		obj.active &&
		typeof obj.active === "object" &&
		Array.isArray((obj.active as BotPolicyData).w1)
	) {
		const state = obj as GlobalPolicyState;
		return {
			active: state.active,
			best: state.best ?? structuredClone(state.active),
			totalMatches: state.totalMatches ?? 0,
			totalGoalEvents: state.totalGoalEvents ?? 0,
			totalSyncs: state.totalSyncs ?? 0,
			updatedAt: state.updatedAt ?? new Date(0).toISOString(),
			progressLog: state.progressLog ?? [],
		};
	}
	if (Array.isArray((raw as BotPolicyData).w1)) {
		return wrapSeedPolicy(raw as BotPolicyData);
	}
	return null;
}

export function emaPolicyData(
	target: BotPolicyData,
	incoming: BotPolicyData,
	alpha: number,
): BotPolicyData {
	const a = clampAlpha(alpha);
	const out = structuredClone(target);
	blendArray(out.w1, incoming.w1, a);
	blendArray(out.b1, incoming.b1, a);
	blendArray(out.w2, incoming.w2, a);
	blendArray(out.b2, incoming.b2, a);
	out.fitness = out.fitness * (1 - a) + incoming.fitness * a;
	out.version = 1;
	return out;
}

function blendArray(target: number[], source: number[], alpha: number): void {
	const n = Math.min(target.length, source.length);
	for (let i = 0; i < n; i++) {
		target[i] = target[i]! * (1 - alpha) + source[i]! * alpha;
	}
}

function clampAlpha(alpha: number): number {
	return Math.max(0.02, Math.min(0.45, alpha));
}

export function policyArchChanged(
	current: GlobalPolicyState,
	incoming: BotPolicyData,
): boolean {
	return (
		current.active.w1.length !== incoming.w1.length ||
		(current.best?.w1.length ?? incoming.w1.length) !== incoming.w1.length
	);
}

/** Offline train — EMA albo pełna zamiana przy zmianie architektury (np. 18→21 wejść). */
export function mergeOfflineTrainPayload(
	current: GlobalPolicyState,
	trained: BotPolicyData,
	clientId: string,
): { merged: GlobalPolicyState; syncPayload: PolicySyncPayload } {
	const basePayload: PolicySyncPayload = {
		active: trained,
		best: structuredClone(trained),
		reason: "offline_train",
		clientId,
	};

	if (policyArchChanged(current, trained)) {
		const merged: GlobalPolicyState = {
			...current,
			active: {
				...structuredClone(trained),
				generation: Math.max(current.active.generation, trained.generation) + 1,
			},
			best: structuredClone(trained),
			totalSyncs: current.totalSyncs + 1,
			updatedAt: new Date().toISOString(),
		};
		return {
			merged,
			syncPayload: {
				...basePayload,
				active: merged.active,
				best: merged.best,
			},
		};
	}

	const merged = mergePolicySyncPayload(current, basePayload);
	return {
		merged,
		syncPayload: {
			...basePayload,
			active: merged.active,
			best: merged.best,
		},
	};
}

export function mergePolicySyncPayload(
	current: GlobalPolicyState,
	payload: PolicySyncPayload,
): GlobalPolicyState {
	const alpha = POLICY_MERGE_ALPHA[payload.reason];

	const mergedActive = emaPolicyData(current.active, payload.active, alpha);
	mergedActive.generation = Math.max(
		current.active.generation,
		payload.active.generation,
	);
	if (payload.reason === "match_end") {
		mergedActive.generation += 1;
	} else if (payload.reason === "offline_train") {
		mergedActive.generation =
			Math.max(mergedActive.generation, payload.active.generation) + 1;
	}

	let mergedBest = current.best;
	if (
		payload.best &&
		(!mergedBest || payload.best.fitness > mergedBest.fitness)
	) {
		mergedBest = structuredClone(payload.best);
	} else if (mergedActive.fitness > (mergedBest?.fitness ?? -Infinity)) {
		mergedBest = structuredClone(mergedActive);
	}

	return {
		active: mergedActive,
		best: mergedBest,
		totalMatches:
			current.totalMatches + (payload.reason === "match_end" ? 1 : 0),
		totalGoalEvents:
			current.totalGoalEvents + (payload.reason === "goal" ? 1 : 0),
		totalSyncs: current.totalSyncs + 1,
		updatedAt: new Date().toISOString(),
		progressLog: appendFederatedProgress(
			current.progressLog ?? [],
			payload,
			mergedActive.generation,
			mergedActive.fitness,
		),
	};
}

function appendFederatedProgress(
	log: FederatedProgressEntry[],
	payload: PolicySyncPayload,
	generation: number,
	fitness: number,
): FederatedProgressEntry[] {
	if (payload.reason !== "match_end") return log;
	const entry: FederatedProgressEntry = {
		ts: new Date().toISOString(),
		generation,
		fitness,
		botDelta: payload.botDelta ?? 0,
		aerialTouches: payload.aerialTouches ?? 0,
	};
	return [...log, entry].slice(-FEDERATED_PROGRESS_CAP);
}

function mergeFederatedProgressLogs(
	a: FederatedProgressEntry[],
	b: FederatedProgressEntry[],
): FederatedProgressEntry[] {
	const map = new Map<string, FederatedProgressEntry>();
	for (const e of [...a, ...b]) map.set(e.ts, e);
	return [...map.values()]
		.sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts))
		.slice(-FEDERATED_PROGRESS_CAP);
}

/** Łączy stany z wielu relayów (fetch federacyjny). */
export function mergeGlobalPolicyStates(
	states: GlobalPolicyState[],
	alpha = 0.28,
): GlobalPolicyState {
	if (states.length === 0) {
		throw new Error("mergeGlobalPolicyStates: brak stanów");
	}

	const sorted = [...states].sort(
		(a, b) =>
			b.active.generation - a.active.generation ||
			b.active.fitness - a.active.fitness,
	);

	const acc = structuredClone(sorted[0]!);
	for (let i = 1; i < sorted.length; i++) {
		const other = sorted[i]!;
		acc.active = emaPolicyData(acc.active, other.active, alpha);
		acc.active.generation = Math.max(
			acc.active.generation,
			other.active.generation,
		);
		if (other.best && (!acc.best || other.best.fitness > acc.best.fitness)) {
			acc.best = structuredClone(other.best);
		} else if (acc.active.fitness > (acc.best?.fitness ?? -Infinity)) {
			acc.best = structuredClone(acc.active);
		}
		acc.totalMatches = Math.max(acc.totalMatches, other.totalMatches);
		acc.totalGoalEvents = Math.max(acc.totalGoalEvents, other.totalGoalEvents);
		acc.totalSyncs = Math.max(acc.totalSyncs, other.totalSyncs);
		acc.progressLog = mergeFederatedProgressLogs(
			acc.progressLog ?? [],
			other.progressLog ?? [],
		);
		const otherTs = Date.parse(other.updatedAt);
		const accTs = Date.parse(acc.updatedAt);
		if (Number.isFinite(otherTs) && otherTs > accTs) {
			acc.updatedAt = other.updatedAt;
		}
	}

	return acc;
}

export function envelopeFromState(
	state: GlobalPolicyState,
): GlobalPolicyEnvelope {
	return {
		active: state.active,
		best: state.best,
	};
}

export type { PolicySyncReason };
