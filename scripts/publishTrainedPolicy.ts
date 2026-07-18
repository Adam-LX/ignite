/**
 * Po treningu offline — scala z globalnym mózgiem i publikuje (GitHub bot-brain + relaye).
 *
 * SKIP_BOT_POLICY_PUBLISH=1 — pomiń
 * GITHUB_TOKEN / GH_TOKEN / gh auth token — wymagane do push na GitHub
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { BotPolicyData } from "../src/ai/learning/BotPolicy.ts";
import { defaultPolicyOutPath } from "../src/ai/learning/BotEvolution.ts";
import type { GlobalPolicyState, PolicySyncPayload } from "../src/net/botPolicyProtocol.ts";
import { githubBotPolicyRawUrl } from "../src/net/githubBotPolicyUrl.ts";
import {
	mergeOfflineTrainPayload,
	normalizePolicyState,
	wrapSeedPolicy,
} from "../src/net/policyMerge.ts";
import { pushGlobalPolicyToGithub } from "../server/githubBotPolicyPush.ts";

const ROOT = process.cwd();
const LOCAL_GLOBAL = resolve(ROOT, "data/global-bot-policy.json");
const RELAY_MANIFEST = resolve(ROOT, "public/policy-relays.json");

function resolveGhToken(): string | null {
	for (const key of [
		"GITHUB_TOKEN",
		"GH_TOKEN",
		"IGNITE_BOT_POLICY_GITHUB_TOKEN",
	]) {
		const v = process.env[key]?.trim();
		if (v) return v;
	}
	for (const gh of ["gh", "/run/current-system/sw/bin/gh"]) {
		try {
			const token = execSync(`${gh} auth token`, {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			if (token) return token;
		} catch {
			// next
		}
	}
	try {
		return execSync("nix shell nixpkgs#gh -c gh auth token", {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 45_000,
		}).trim();
	} catch {
		return null;
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
			if (res.ok) {
				hits += 1;
				console.info(`[BotPublish] relay ok → ${new URL(url).hostname}`);
			} else {
				console.warn(
					`[BotPublish] relay ${new URL(url).hostname} → HTTP ${res.status}`,
				);
			}
		} catch {
			console.warn(`[BotPublish] relay offline → ${new URL(url).hostname}`);
		}
	}
	return hits;
}

async function pushGithubWithFallback(
	merged: GlobalPolicyState,
	reason: string,
): Promise<boolean> {
	const token = resolveGhToken();
	if (token) process.env.GITHUB_TOKEN = token;

	if (await pushGlobalPolicyToGithub(merged, reason)) {
		return true;
	}

	try {
		execSync("nix shell nixpkgs#gh -c bash scripts/publish-bot-policy-github.sh", {
			cwd: ROOT,
			stdio: "inherit",
		});
		return true;
	} catch {
		return false;
	}
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

	const { merged, syncPayload } = mergeOfflineTrainPayload(
		current,
		trained,
		"ignite-train-cli",
	);

	mkdirSync(resolve(LOCAL_GLOBAL, ".."), { recursive: true });
	writeFileSync(LOCAL_GLOBAL, JSON.stringify(merged, null, 2));

	const githubOk = await pushGithubWithFallback(merged, "offline_train");
	const relayHits = await postToRelays(syncPayload);

	console.info(
		`[BotPublish] gen=${merged.active.generation} fit=${merged.active.fitness.toFixed(2)} ` +
			`inputs=${merged.active.w1.length / 32} ` +
			`github=${githubOk ? "ok" : "FAIL"} relays=${relayHits}`,
	);

	if (!githubOk && relayHits === 0) {
		console.error(
			"[BotPublish] Federacja nieudana — inni gracze nie dostaną wag. " +
				"Zaloguj: nix shell nixpkgs#gh -c gh auth login",
		);
		return false;
	}

	console.info(`[BotPublish] global → ${githubBotPolicyRawUrl()}`);
	return true;
}

const isCli = process.argv[1]?.includes("publishTrainedPolicy") ?? false;

if (isCli) {
	publishTrainedPolicy()
		.then((ok) => {
			if (!ok && process.env.BOT_POLICY_PUBLISH_REQUIRED !== "0") {
				process.exit(1);
			}
		})
		.catch((err) => {
			console.error("[BotPublish] błąd:", err);
			process.exit(1);
		});
}
