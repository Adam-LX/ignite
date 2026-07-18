import { describe, expect, it } from "vitest";

import {
	BOT_IQ_BASE,
	BOT_IQ_MAX,
	BOT_IQ_MIN,
	computeBotIQ,
	iqLabelTier,
	iqToGaugeFill,
} from "../../src/ai/learning/BotIQ";

describe("BotIQ", () => {
	it("świeży bot ~100, silna forma podnosi IQ", () => {
		const rookie = computeBotIQ({
			generation: 2,
			fitness: 0.5,
			bestFitness: 1,
			recentBotDeltaAvg: 0,
			aerialPerMatch: 0.2,
			recoveryEfficiency: 0.35,
			microPromotions: 0,
			maturity: 0.35,
		});
		const sharp = computeBotIQ({
			generation: 24,
			fitness: 6,
			bestFitness: 9,
			recentBotDeltaAvg: 2.2,
			aerialPerMatch: 2,
			recoveryEfficiency: 0.92,
			microPromotions: 8,
			maturity: 0.7,
		});
		expect(rookie).toBeGreaterThanOrEqual(BOT_IQ_MIN);
		expect(rookie).toBeLessThan(115);
		expect(sharp).toBeGreaterThan(rookie);
		expect(sharp).toBeLessThanOrEqual(BOT_IQ_MAX);
	});

	it("przegrane obniżają IQ względem wygranych", () => {
		const wins = computeBotIQ({
			generation: 10,
			fitness: 4,
			bestFitness: 6,
			recentBotDeltaAvg: 2,
			aerialPerMatch: 1,
			recoveryEfficiency: 0.85,
			microPromotions: 2,
			maturity: 0.5,
		});
		const losses = computeBotIQ({
			generation: 10,
			fitness: 4,
			bestFitness: 6,
			recentBotDeltaAvg: -2,
			aerialPerMatch: 1,
			recoveryEfficiency: 0.85,
			microPromotions: 2,
			maturity: 0.5,
		});
		expect(wins).toBeGreaterThan(losses);
	});

	it("słabe recovery obniża IQ", () => {
		const good = computeBotIQ({
			generation: 12,
			fitness: 5,
			bestFitness: 7,
			recentBotDeltaAvg: 1,
			aerialPerMatch: 1.2,
			recoveryEfficiency: 0.95,
			microPromotions: 3,
			maturity: 0.55,
		});
		const bad = computeBotIQ({
			generation: 12,
			fitness: 5,
			bestFitness: 7,
			recentBotDeltaAvg: 1,
			aerialPerMatch: 1.2,
			recoveryEfficiency: 0.25,
			microPromotions: 3,
			maturity: 0.55,
		});
		expect(good).toBeGreaterThan(bad);
	});

	it("gauge i tier", () => {
		expect(iqToGaugeFill(BOT_IQ_BASE)).toBeGreaterThan(0.2);
		expect(iqLabelTier(95)).toBe("rookie");
		expect(iqLabelTier(125)).toBe("sharp");
		expect(iqLabelTier(145)).toBe("elite");
	});
});
