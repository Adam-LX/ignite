import { describe, expect, it } from "vitest";

import {
	githubBotPolicyRawUrl,
	resolveGithubBotPolicyConfig,
} from "../../src/net/githubBotPolicyUrl";

describe("githubBotPolicyUrl", () => {
	it("domyślny raw URL — ignite-releases bot-brain", () => {
		const url = githubBotPolicyRawUrl();
		expect(url).toBe(
			"https://raw.githubusercontent.com/Adam-LX/ignite-releases/bot-brain/global-bot-policy.json",
		);
	});

	it("resolveGithubBotPolicyConfig — repo slug z env", () => {
		const prev = process.env.IGNITE_BOT_POLICY_GITHUB_REPO;
		process.env.IGNITE_BOT_POLICY_GITHUB_REPO = "foo/bar";
		try {
			const cfg = resolveGithubBotPolicyConfig();
			expect(cfg.owner).toBe("foo");
			expect(cfg.repo).toBe("bar");
		} finally {
			if (prev === undefined) delete process.env.IGNITE_BOT_POLICY_GITHUB_REPO;
			else process.env.IGNITE_BOT_POLICY_GITHUB_REPO = prev;
		}
	});
});
