/**
 * Po treningu offline — scala z globalnym mózgiem i publikuje (GitHub bot-brain + relaye).
 *
 * SKIP_BOT_POLICY_PUBLISH=1 — pomiń
 * GITHUB_TOKEN / GH_TOKEN / gh auth token — wymagane do push na GitHub
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { BotPolicyData } from "../src/ai/learning/BotPolicy.ts";
import { defaultPolicyOutPath } from "../src/ai/learning/BotEvolution.ts";
import type { GlobalPolicyState, PolicySyncPayload } from "../src/net/botPolicyProtocol.ts";
import { githubBotPolicyRawUrl } from "../src/net/githubBotPolicyUrl.ts";
import {
	mergePolicySyncPayload,
	normalizePolicyState,
	wrapSeedPolicy,
} from "../src/net/policyMerge.ts";
import { pushGlobalPolicyToGithub } from "../server/githubBotPolicyPush.ts";

const ROOT = process.cwd();
const LOCAL_GLOBAL = resolve(ROOT, "data/global-bot-policy.json");
const RELAY_MANIFEST = resolve(ROOT, "public/policy-relays.json");

function ensureGithubToken(): void {
	if (
		process.env.GITHUB_TOKEN?.trim() ||
		process.env.GH_TOKEN?.trim() ||
		process.env.IGNITE_BOT_POLICY_GITHUB_TOKEN?.trim()
	) {
		return;
	}
	try {
		const token = execSync("gh auth token", {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (token) process.env.GITHUB_TOKEN = token;
	} catch {
		// brak gh — push może się nie udać
	}
}

async function fetchCanonicalGlobal(): Promise<GlobalPolicyState | null> {
	try {
		const res = await fetch(githubBotPolicyRawUrl(), { cache: "no-store" });
		if (!res.ok) return null;
		return normalizePolicyState(await res.json());
	} catch {
		return null;
	}
}

function readSyncUrls(): string[] {
	try {
		const manifest = JSON.parse(readFileSync(RELAY_MANIFEST, "utf8")) as {
			sync?: string[];
		};
		return (manifest.sync ?? []).filter(
			(url): url is string =>
				typeof url === "string" && url.startsWith("http"),
		);
	} catch {
		return [];
	}
}

async function postToRelays(payload: PolicySyncPayload): Promise<number> {
	const urls = readSyncUrls();
	let hits = 0;
	for (const url of urls) {
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (res.ok) hits += 1;
		} catch {
			// relay offline
		}
	}
	return hits;
}

export async function publishTrainedPolicy(
	policyPath = process.env.BOT_TRAIN_OUT ?? defaultPolicyOutPath(),
): Promise<boolean> {
	if (process.env.SKIP_BOT_POLICY_PUBLISH === "1") {
		console.info("[BotPublish] SKIP_BOT_POLICY_PUBLISH=1 — pomijam federację");
		return false;
	}

	const trained = JSON.parse(
		readFileSync(policyPath, "utf8"),
	) as BotPolicyData;

	const current =
		(await fetchCanonicalGlobal()) ??
		normalizePolicyState(
			(() => {
				try {
					return JSON.parse(readFileSync(LOCAL_GLOBAL, "utf8"));
				} catch {
					return null;
				}
			})(),
		) ??
		wrapSeedPolicy(trained);

	const payload: PolicySyncPayload = {
		active: trained,
		best: structuredClone(trained),
		reason: "offline_train",
		clientId: "ignite-train-cli",
	};

	const merged = mergePolicySyncPayload(current, payload);

	mkdirSync(resolve(LOCAL_GLOBAL, ".."), { recursive: true });
	writeFileSync(LOCAL_GLOBAL, JSON.stringify(merged, null, 2));

	ensureGithubToken();
	const githubOk = await pushGlobalPolicyToGithub(merged, "offline_train");
	const relayHits = await postToRelays(payload);

	console.info(
		`[BotPublish] gen=${merged.active.generation} fit=${merged.active.fitness.toFixed(2)} ` +
			`github=${githubOk ? "ok" : "skip"} relays=${relayHits}`,
	);

	if (!githubOk && relayHits === 0) {
		console.warn(
			"[BotPublish] Nie udało się wypchnąć globalnie — ustaw GITHUB_TOKEN lub uruchom relay (mp:server)",
		);
		return false;
	}

	console.info(`[BotPublish] global → ${githubBotPolicyRawUrl()}`);
	return true;
}

const isCli =
	typeof process.argv[1] === "string" &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
	publishTrainedPolicy()
		.then((ok) => {
			if (!ok && process.env.BOT_POLICY_PUBLISH_REQUIRED === "1") {
				process.exit(1);
			}
		})
		.catch((err) => {
			console.error("[BotPublish] błąd:", err);
			process.exit(1);
		});
}
