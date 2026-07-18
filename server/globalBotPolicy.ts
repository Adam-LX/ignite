import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BotPolicy, type BotPolicyData } from "../src/ai/learning/BotPolicy.ts";
import {
	mergeGlobalPolicyStates,
	mergeOfflineTrainPayload,
	mergePolicySyncPayload,
	normalizePolicyState,
} from "../src/net/policyMerge.ts";
import type {
	GlobalPolicyEnvelope,
	GlobalPolicyState,
	PolicySyncPayload,
	PolicySyncReason,
} from "../src/net/botPolicyProtocol.ts";
import { githubBotPolicyRawUrl } from "../src/net/githubBotPolicyUrl.ts";
import { pushGlobalPolicyToGithub } from "./githubBotPolicyPush.ts";

const DATA_DIR = resolve(process.cwd(), "data");
const POLICY_PATH = resolve(DATA_DIR, "global-bot-policy.json");
const SEED_PATH = resolve(process.cwd(), "public/assets/ai/bot-policy.json");
const RELAY_MANIFEST_PATH = resolve(
	process.cwd(),
	"public/policy-relays.json",
);

let state: GlobalPolicyState | null = null;

export function getGlobalPolicyState(): GlobalPolicyState {
	if (!state) {
		state = loadFromDisk();
	}
	return state;
}

export function mergePolicySync(payload: PolicySyncPayload): GlobalPolicyState {
	const current = getGlobalPolicyState();
	const next =
		payload.reason === "offline_train"
			? mergeOfflineTrainPayload(
					current,
					payload.active,
					payload.clientId ?? "relay",
				).merged
			: mergePolicySyncPayload(current, payload);
	state = next;
	saveToDisk(next);
	return next;
}

/** Przed merge — dociągnij mózg z innych relayów (serwer też federuje). */
export async function pullFederatedPolicyIntoLocal(): Promise<boolean> {
	const urls = collectServerFetchUrls();
	if (urls.length === 0) return false;

	const states: GlobalPolicyState[] = [];
	for (const url of urls) {
		const remote = await fetchPolicyUrl(url);
		if (remote) states.push(remote);
	}
	if (states.length === 0) return false;

	const current = getGlobalPolicyState();
	const merged = mergeGlobalPolicyStates([current, ...states], 0.24);
	state = merged;
	saveToDisk(merged);
	return true;
}

export async function mergePolicySyncFederated(
	payload: PolicySyncPayload,
): Promise<GlobalPolicyState> {
	await pullFederatedPolicyIntoLocal();
	const next = mergePolicySync(payload);
	void pushGlobalPolicyToGithub(next, payload.reason);
	return next;
}

function collectServerFetchUrls(): string[] {
	const urls = new Set<string>();

	const envList = (process.env.IGNITE_POLICY_FETCH_URLS ?? "")
		.split(/[,;\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);
	for (const url of envList) urls.add(url);

	const canonical = process.env.IGNITE_POLICY_CANONICAL_URL?.trim();
	if (canonical) urls.add(canonical);

	urls.add(githubBotPolicyRawUrl());

	try {
		const raw = readFileSync(RELAY_MANIFEST_PATH, "utf8");
		const manifest = JSON.parse(raw) as { fetch?: string[] };
		for (const url of manifest.fetch ?? []) {
			if (url.startsWith("http")) urls.add(url);
		}
	} catch {
		// brak manifestu
	}

	return [...urls];
}

async function fetchPolicyUrl(url: string): Promise<GlobalPolicyState | null> {
	try {
		const res = await fetch(url, { cache: "no-store" });
		if (!res.ok) return null;
		return normalizePolicyState(await res.json());
	} catch {
		return null;
	}
}

function loadFromDisk(): GlobalPolicyState {
	try {
		const raw = readFileSync(POLICY_PATH, "utf8");
		const parsed = normalizePolicyState(JSON.parse(raw));
		if (parsed) return parsed;
	} catch {
		// seed below
	}

	const seeded = seedFromFile();
	const initial: GlobalPolicyState = {
		active: seeded.active,
		best: seeded.best,
		totalMatches: 0,
		totalGoalEvents: 0,
		totalSyncs: 0,
		updatedAt: new Date().toISOString(),
		progressLog: [],
	};
	saveToDisk(initial);
	return initial;
}

function seedFromFile(): GlobalPolicyEnvelope {
	try {
		const raw = readFileSync(SEED_PATH, "utf8");
		const data = JSON.parse(raw) as BotPolicyData;
		return { active: data, best: structuredClone(data) };
	} catch {
		const policy = new BotPolicy(42);
		policy.generation = 1;
		policy.fitness = 0;
		const data = policy.toData();
		return { active: data, best: structuredClone(data) };
	}
}

function saveToDisk(next: GlobalPolicyState): void {
	mkdirSync(DATA_DIR, { recursive: true });
	const tmp = `${POLICY_PATH}.tmp`;
	writeFileSync(tmp, JSON.stringify(next, null, 2));
	renameSync(tmp, POLICY_PATH);
}

export function policyPathForLogs(): string {
	return POLICY_PATH;
}

export type { PolicySyncReason };
