import { describe, expect, it } from "vitest";

import { BotPolicy } from "../../src/ai/learning/BotPolicy";
import { evaluateRecoveryEpisode } from "../../src/ai/learning/HeadlessBotMatch";
import { BotLearning } from "../../src/ai/learning/BotLearning";
import { computeMatchRecoveryEfficiency } from "../../src/ai/botRecovery";

describe("Headless recovery fitness", () => {
	it("evaluateRecoveryEpisode zwraca fitness dla turtle", async () => {
		BotLearning.resetForTests();
		const policy = new BotPolicy(42);
		const result = await evaluateRecoveryEpisode(policy, "turtle", 3, 7);
		expect(result.scenario).toBe("turtle");
		expect(result.fitness).toBeGreaterThanOrEqual(0);
		expect(result.fitness).toBeLessThanOrEqual(100);
	}, 15_000);

	it("computeMatchRecoveryEfficiency preferuje szybki powrót", () => {
		const fast = computeMatchRecoveryEfficiency(12, 100, [0.6, 0.8]);
		const slow = computeMatchRecoveryEfficiency(40, 100, [3.2, 3.8]);
		expect(fast).toBeGreaterThan(slow);
	});
});
