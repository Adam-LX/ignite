import type { GlobalPolicyState } from "../src/net/botPolicyProtocol.ts";
import {
	githubBotPolicyRawUrl,
	resolveGithubBotPolicyConfig,
} from "../src/net/githubBotPolicyUrl.ts";

const GITHUB_API = "https://api.github.com";
const MIN_PUSH_INTERVAL_MS = 90_000;

let lastPushAt = 0;
let pushInFlight = false;

function readToken(): string | null {
	const token =
		process.env.GITHUB_TOKEN?.trim() ||
		process.env.GH_TOKEN?.trim() ||
		process.env.IGNITE_BOT_POLICY_GITHUB_TOKEN?.trim();
	return token || null;
}

function readEnv(name: string): string {
	return process.env[name]?.trim() ?? "";
}

export function isGithubBotPolicyPushEnabled(): boolean {
	if (readEnv("IGNITE_BOT_POLICY_GITHUB_PUSH") === "0") return false;
	return readToken() !== null;
}

async function ensureGithubBranch(
	token: string,
	cfg: ReturnType<typeof resolveGithubBotPolicyConfig>,
): Promise<boolean> {
	const headers = githubHeaders(token);
	const refUrl = `${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.branch)}`;
	const check = await fetch(refUrl, { headers });
	if (check.ok) return true;

	const repoRes = await fetch(`${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}`, {
		headers,
	});
	if (!repoRes.ok) return false;
	const repoJson = (await repoRes.json()) as { default_branch?: string };
	const baseBranch = repoJson.default_branch ?? "main";

	const baseRefRes = await fetch(
		`${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
		{ headers },
	);
	if (!baseRefRes.ok) return false;
	const baseRef = (await baseRefRes.json()) as { object?: { sha?: string } };
	const sha = baseRef.object?.sha;
	if (!sha) return false;

	const createRes = await fetch(
		`${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}/git/refs`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({
				ref: `refs/heads/${cfg.branch}`,
				sha,
			}),
		},
	);
	return createRes.ok || createRes.status === 422;
}

/** Wypchnij scalony mózg na gałąź bot-brain w repo GitHub (Contents API). */
export async function pushGlobalPolicyToGithub(
	state: GlobalPolicyState,
	reason: string,
): Promise<boolean> {
	if (!isGithubBotPolicyPushEnabled()) return false;

	const now = Date.now();
	if (pushInFlight || now - lastPushAt < MIN_PUSH_INTERVAL_MS) {
		return false;
	}

	const token = readToken()!;
	const cfg = resolveGithubBotPolicyConfig();
	const path = cfg.path.replace(/^\/+/, "");
	const url = `${GITHUB_API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;

	pushInFlight = true;
	try {
		await ensureGithubBranch(token, cfg);

		let sha: string | undefined;
		const getRes = await fetch(`${url}?ref=${encodeURIComponent(cfg.branch)}`, {
			headers: githubHeaders(token),
		});
		if (getRes.ok) {
			const existing = (await getRes.json()) as { sha?: string };
			sha = existing.sha;
		} else if (getRes.status !== 404) {
			console.warn(`[BotPolicy/GitHub] GET ${path} → ${getRes.status}`);
			return false;
		}

		const payload = {
			...state,
			githubPushedAt: new Date().toISOString(),
			githubPushReason: reason,
		};
		const content = Buffer.from(
			JSON.stringify(payload, null, 2),
			"utf8",
		).toString("base64");

		const putRes = await fetch(url, {
			method: "PUT",
			headers: githubHeaders(token),
			body: JSON.stringify({
				message: `bot-brain: ${reason} gen ${state.active.generation} fit ${state.active.fitness.toFixed(2)}`,
				content,
				branch: cfg.branch,
				...(sha ? { sha } : {}),
			}),
		});

		if (!putRes.ok) {
			const errText = await putRes.text();
			console.warn(
				`[BotPolicy/GitHub] PUT failed ${putRes.status}: ${errText.slice(0, 200)}`,
			);
			return false;
		}

		lastPushAt = Date.now();
		console.info(
			`[BotPolicy/GitHub] ↑ ${cfg.owner}/${cfg.repo}@${cfg.branch}/${path} (gen ${state.active.generation})`,
		);
		return true;
	} catch (err) {
		console.warn("[BotPolicy/GitHub] push error", err);
		return false;
	} finally {
		pushInFlight = false;
	}
}

function githubHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "Ignite-BotBrain/1.0",
	};
}

export function githubBotPolicyPublicUrl(): string {
	return githubBotPolicyRawUrl();
}
