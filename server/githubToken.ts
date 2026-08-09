/**
 * Wspólne źródło tokenu GitHub (env + `gh auth token` z keyringa).
 * Używane przez bot-policy push i player-report Issues.
 */
import { execSync } from "node:child_process";

export function resolveGithubToken(): string | null {
	for (const key of [
		"GITHUB_TOKEN",
		"GH_TOKEN",
		"IGNITE_BOT_POLICY_GITHUB_TOKEN",
		"IGNITE_REPORT_GITHUB_TOKEN",
	]) {
		const v = process.env[key]?.trim();
		if (v) return v;
	}

	const cmds = [
		"gh auth token",
		"/run/current-system/sw/bin/gh auth token",
		"nix shell nixpkgs#gh -c gh auth token",
	];
	for (const cmd of cmds) {
		try {
			const token = execSync(cmd, {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 20_000,
			}).trim();
			if (token) return token;
		} catch {
			/* next */
		}
	}
	return null;
}

export function githubTokenSourceHint(): string {
	if (process.env.GITHUB_TOKEN?.trim()) return "env:GITHUB_TOKEN";
	if (process.env.GH_TOKEN?.trim()) return "env:GH_TOKEN";
	if (process.env.IGNITE_BOT_POLICY_GITHUB_TOKEN?.trim())
		return "env:IGNITE_BOT_POLICY_GITHUB_TOKEN";
	if (process.env.IGNITE_REPORT_GITHUB_TOKEN?.trim())
		return "env:IGNITE_REPORT_GITHUB_TOKEN";
	return "gh-auth-keyring";
}
