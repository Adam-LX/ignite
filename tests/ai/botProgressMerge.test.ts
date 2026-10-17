import { describe, expect, it } from "vitest";

import {
	federatedEntryToProgressEntry,
	mergeProgressLogsForReport,
} from "../../src/ai/learning/BotLearningProgress";

describe("mergeProgressLogsForReport", () => {
	it("łączy federację z lokalnym bez duplikatów", () => {
		const fed = [
			{
				ts: "2026-07-01T12:00:00.000Z",
				generation: 10,
				fitness: 5,
				botDelta: -1,
				aerialTouches: 0,
			},
		];
		const local = [
			federatedEntryToProgressEntry(fed[0]!, 8),
			{
				ts: Date.parse("2026-07-01T12:05:00.000Z"),
				generation: 11,
				fitness: 6,
				bestFitness: 8,
				botDelta: 2,
				aerialTouches: 1,
				microEvolved: false,
				source: "match" as const,
			},
		];

		const merged = mergeProgressLogsForReport(fed, local, 8);
		expect(merged).toHaveLength(2);
		expect(merged[1]?.botDelta).toBe(2);
	});
});
