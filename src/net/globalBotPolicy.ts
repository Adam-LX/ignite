import type {
	GlobalPolicyEnvelope,
	GlobalPolicyState,
	PolicySyncPayload,
} from "./botPolicyProtocol";
import {
	getCachedPolicyEndpoints,
	resolvePolicyEndpoints,
} from "./policyEndpoints";
import { mergeGlobalPolicyStates, normalizePolicyState } from "./policyMerge";

const CLIENT_ID_KEY = "ignite-bot-client-id";

let lastFetchHits = 0;
let lastSyncHits = 0;
let lastFederationAt = 0;

function getClientId(): string {
	try {
		let id = localStorage.getItem(CLIENT_ID_KEY);
		if (!id) {
			id = `c_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
			localStorage.setItem(CLIENT_ID_KEY, id);
		}
		return id;
	} catch {
		return "anon";
	}
}

function resolveFetchUrl(url: string): string {
	if (
		typeof window !== "undefined" &&
		url.startsWith("/") &&
		!url.startsWith("//")
	) {
		return new URL(url, window.location.origin).href;
	}
	return url;
}

async function fetchPolicyFromUrl(
	url: string,
	timeoutMs: number,
): Promise<GlobalPolicyState | null> {
	const controller = new AbortController();
	const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetch(resolveFetchUrl(url), {
			signal: controller.signal,
			cache: "no-store",
		});
		if (!res.ok) return null;
		const json: unknown = await res.json();
		return normalizePolicyState(json);
	} catch {
		return null;
	} finally {
		window.clearTimeout(timeout);
	}
}

async function postPolicySync(
	url: string,
	body: PolicySyncPayload,
	timeoutMs: number,
): Promise<GlobalPolicyState | null> {
	const controller = new AbortController();
	const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetch(resolveFetchUrl(url), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			signal: controller.signal,
			body: JSON.stringify(body),
		});
		if (!res.ok) return null;
		const json = (await res.json()) as { state?: GlobalPolicyState };
		if (json.state) return json.state;
		return normalizePolicyState(await res.json());
	} catch {
		return null;
	} finally {
		window.clearTimeout(timeout);
	}
}

/** Pobiera i scala mózg ze wszystkich znanych relayów (nie tylko lokalny serwer). */
export async function fetchGlobalBotPolicy(): Promise<GlobalPolicyState | null> {
	const endpoints = await resolvePolicyEndpoints();
	const results = await Promise.all(
		endpoints.fetch.map((url) => fetchPolicyFromUrl(url, 4500)),
	);

	const states = results.filter((s): s is GlobalPolicyState => s !== null);
	lastFetchHits = states.length;
	lastFederationAt = Date.now();

	if (states.length === 0) return null;
	if (states.length === 1) return states[0]!;

	return mergeGlobalPolicyStates(states);
}

/** Wysyła update na wszystkie relaye — wiedza rozchodzi się między serwerami. */
export async function pushGlobalBotPolicy(
	envelope: GlobalPolicyEnvelope,
	reason: PolicySyncPayload["reason"],
	botDelta?: number,
	aerialTouches?: number,
): Promise<GlobalPolicyState | null> {
	const endpoints = await resolvePolicyEndpoints();
	const body: PolicySyncPayload = {
		...envelope,
		reason,
		botDelta,
		aerialTouches,
		clientId: getClientId(),
	};

	const results = await Promise.all(
		endpoints.sync.map((url) => postPolicySync(url, body, 6500)),
	);

	const merged = results.filter((s): s is GlobalPolicyState => s !== null);
	lastSyncHits = merged.length;
	lastFederationAt = Date.now();

	if (merged.length === 0) return null;
	if (merged.length === 1) return merged[0]!;

	return mergeGlobalPolicyStates(merged, 0.22);
}

export function getPolicyFederationStats(): {
	fetchHits: number;
	syncHits: number;
	fetchTargets: number;
	syncTargets: number;
	lastAt: number;
} {
	const cached = getCachedPolicyEndpoints();
	return {
		fetchHits: lastFetchHits,
		syncHits: lastSyncHits,
		fetchTargets: cached?.fetch.length ?? 0,
		syncTargets: cached?.sync.length ?? 0,
		lastAt: lastFederationAt,
	};
}

export function getPolicyServerLabel(): string {
	const cached = getCachedPolicyEndpoints();
	if (!cached) return "federated";
	return `${cached.sync.length} relay(s)`;
}
