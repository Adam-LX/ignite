import type { BotPolicyData } from "../ai/learning/BotPolicy";

export type GlobalPolicyEnvelope = {
	active: BotPolicyData;
	best: BotPolicyData | null;
};

export type GlobalPolicyState = GlobalPolicyEnvelope & {
	totalMatches: number;
	totalGoalEvents: number;
	totalSyncs: number;
	updatedAt: string;
	/** Ostatnie mecze ze wszystkich klientów (ring buffer pod raport UI). */
	progressLog?: FederatedProgressEntry[];
};

/** Zwięzły wpis meczu do federacyjnego raportu. */
export type FederatedProgressEntry = {
	ts: string;
	generation: number;
	fitness: number;
	botDelta: number;
	aerialTouches: number;
};

export type PolicySyncReason = "goal" | "match_end" | "offline_train";

export type PolicySyncPayload = GlobalPolicyEnvelope & {
	reason: PolicySyncReason;
	botDelta?: number;
	aerialTouches?: number;
	clientId?: string;
};

export type PolicySyncResponse = {
	ok: true;
	state: GlobalPolicyState;
	merged: boolean;
};

export const POLICY_MERGE_ALPHA = {
	goal: 0.07,
	match_end: 0.24,
	offline_train: 0.55,
} as const;

export function defaultPolicyServerHost(): string {
	if (typeof window !== "undefined" && window.location?.hostname) {
		return window.location.hostname;
	}
	return "localhost";
}

export function buildPolicyHttpUrl(
	host: string,
	port: number,
	path: string,
): string {
	return `http://${host}:${port}${path}`;
}
