import { describe, expect, it } from "vitest";

import {
	aggregateMatchProbes,
	runMatchProbe,
	runMatchProbeMatch,
} from "../../src/diagnostic/MatchProbeRunner";
import { deriveMatchProbeFindings } from "../../src/diagnostic/matchProbeFindings";

describe("MatchProbeRunner smoke", () => {
	it(
		"1 mecz 15 s — telemetria + agregat + findings bez crasha",
		{ timeout: 120_000 },
		async () => {
			const m = await runMatchProbeMatch(15, 101, "1v1");
			expect(m.mode).toBe("1v1");
			expect(m.seconds).toBe(15);
			expect(m.cars).toHaveLength(2);
			expect(m.kickoffDiagonalOk).toBe(true);
			expect(m.maxPassiveRegenDelta).toBeLessThan(0.05);

			const report = await runMatchProbe({
				matches: 1,
				seconds: 12,
				seed: 202,
				writeFiles: false,
			});
			expect(report.aggregate.matchCount).toBe(1);
			const agg = aggregateMatchProbes([m]);
			expect(agg.kickoffDiagonalFailRate).toBe(0);
			expect(Array.isArray(deriveMatchProbeFindings(agg))).toBe(true);
			expect(report.findings.length).toBeGreaterThanOrEqual(0);
		},
	);
});
