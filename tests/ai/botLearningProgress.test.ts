import { describe, expect, it, beforeEach, vi } from "vitest";

import {
	formatTrend,
	recordBotProgress,
	getBotProgressLog,
	summarizeBotProgress,
	clearBotProgressLog,
} from "../../src/ai/learning/BotLearningProgress";

describe("BotLearningProgress", () => {
	const store = new Map<string, string>();

	beforeEach(() => {
		store.clear();
		const ls = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => {
				store.set(k, v);
			},
			removeItem: (k: string) => {
				store.delete(k);
			},
		};
		vi.stubGlobal("localStorage", ls);
	});
	it("formatTrend", () => {
		expect(formatTrend(0.8)).toBe("↑0.8");
		expect(formatTrend(-0.3)).toBe("↓0.3");
		expect(formatTrend(0.02)).toBe("→0");
	});

	it("summarizeBotProgress liczy trend fitness i IQ", () => {
		const log = Array.from({ length: 16 }, (_, i) => ({
			ts: i,
			generation: i + 1,
			fitness: i < 8 ? 2 : 6,
			bestFitness: 6,
			botDelta: i < 8 ? -1 : 2,
			aerialTouches: i % 3,
			microEvolved: false,
			source: "match" as const,
			iq: i < 8 ? 98 : 118,
		}));
		const s = summarizeBotProgress(log);
		expect(s.fitnessTrend).toBeGreaterThan(2);
		expect(s.iqTrend).toBeGreaterThan(10);
		expect(s.iq).toBeGreaterThan(100);
		expect(s.winRateRecent).toBeGreaterThan(0.4);
		expect(s.sparkline.length).toBe(16);
		expect(s.iqSparkline.length).toBe(16);
		expect(s.deltaSparkline.length).toBe(16);
	});

	it("recordBotProgress zapisuje do localStorage", () => {
		clearBotProgressLog();
		recordBotProgress({
			ts: 1,
			generation: 2,
			fitness: 3,
			bestFitness: 4,
			botDelta: 1,
			aerialTouches: 2,
			microEvolved: false,
			source: "match",
		});
		expect(getBotProgressLog().length).toBe(1);
		clearBotProgressLog();
	});
});
