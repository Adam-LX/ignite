/** Publiczny URL mózgu botów na GitHub (raw) — bez tokenu, tylko odczyt. */
export type GithubBotPolicyConfig = {
	owner: string;
	repo: string;
	branch: string;
	path: string;
};

const DEFAULT: GithubBotPolicyConfig = {
	owner: "Adam-LX",
	repo: "ignite-releases",
	branch: "bot-brain",
	path: "global-bot-policy.json",
};

function readEnv(name: string): string {
	if (typeof import.meta !== "undefined") {
		const v = (import.meta.env as Record<string, string | undefined>)?.[name];
		if (v?.trim()) return v.trim();
	}
	if (typeof process !== "undefined" && process.env?.[name]?.trim()) {
		return process.env[name]!.trim();
	}
	return "";
}

export function resolveGithubBotPolicyConfig(): GithubBotPolicyConfig {
	const repoSlug =
		readEnv("VITE_IGNITE_BOT_POLICY_GITHUB_REPO") ||
		readEnv("IGNITE_BOT_POLICY_GITHUB_REPO");
	if (repoSlug.includes("/")) {
		const [owner, repo] = repoSlug.split("/", 2);
		return {
			owner: owner || DEFAULT.owner,
			repo: repo || DEFAULT.repo,
			branch:
				readEnv("VITE_IGNITE_BOT_POLICY_GITHUB_BRANCH") ||
				readEnv("IGNITE_BOT_POLICY_GITHUB_BRANCH") ||
				DEFAULT.branch,
			path:
				readEnv("VITE_IGNITE_BOT_POLICY_GITHUB_PATH") ||
				readEnv("IGNITE_BOT_POLICY_GITHUB_PATH") ||
				DEFAULT.path,
		};
	}

	return {
		owner: readEnv("VITE_IGNITE_BOT_POLICY_GITHUB_OWNER") || DEFAULT.owner,
		repo: readEnv("VITE_IGNITE_BOT_POLICY_GITHUB_REPO_NAME") || DEFAULT.repo,
		branch:
			readEnv("VITE_IGNITE_BOT_POLICY_GITHUB_BRANCH") ||
			readEnv("IGNITE_BOT_POLICY_GITHUB_BRANCH") ||
			DEFAULT.branch,
		path:
			readEnv("VITE_IGNITE_BOT_POLICY_GITHUB_PATH") ||
			readEnv("IGNITE_BOT_POLICY_GITHUB_PATH") ||
			DEFAULT.path,
	};
}

export function githubBotPolicyRawUrl(
	cfg = resolveGithubBotPolicyConfig(),
): string {
	const path = cfg.path.replace(/^\/+/, "");
	return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${path}`;
}
