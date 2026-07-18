import { describe, expect, it } from "vitest";

import {
	deriveMatchProbeFindings,
	formatFindingsMarkdown,
} from "../../src/diagnostic/matchProbeFindings";
import type { MatchProbeAggregate } from "../../src/diagnostic/matchProbeTypes";

function baseAgg(
	over: Partial<MatchProbeAggregate> = {},
): MatchProbeAggregate {
	return {
		matchCount: 5,
		mode: "1v1",
		secondsPerMatch: 90,
		avgBlueGoals: 1,
		avgOrangeGoals: 1,
		avgBallTouches: 20,
		avgKickoffFirstContactSec: 2.5,
		kickoffContactOver4sRate: 0,
		kickoffDiagonalFailRate: 0,
		avgBoostFuel: 0.4,
		avgPadSeeks: 3,
		avgPadPickups: 2,
		recoveryFailRate: 0,
		avgWhiffs: 1,
		avgBoostWasteSec: 0.5,
		nearMissDeadHitRate: 0.02,
		passiveRegenSuspect: false,
		avgWallSec: 2,
		avgCeilingSec: 0.2,
		matches: [],
		...over,
	};
}

describe("deriveMatchProbeFindings", () => {
	it("brak alertów przy zdrowych metrykach", () => {
		expect(deriveMatchProbeFindings(baseAgg())).toEqual([]);
	});

	it("kickoff_slow_contact przy wysokim rate", () => {
		const f = deriveMatchProbeFindings(
			baseAgg({ kickoffContactOver4sRate: 0.5, avgKickoffFirstContactSec: 5 }),
		);
		expect(f.some((x) => x.id === "kickoff_slow_contact")).toBe(true);
	});

	it("kickoff_not_diagonal", () => {
		const f = deriveMatchProbeFindings(
			baseAgg({ kickoffDiagonalFailRate: 1 }),
		);
		expect(f.map((x) => x.id)).toContain("kickoff_not_diagonal");
	});

	it("passive_regen_leak", () => {
		const f = deriveMatchProbeFindings(
			baseAgg({ passiveRegenSuspect: true }),
		);
		expect(f.map((x) => x.id)).toContain("passive_regen_leak");
	});

	it("recovery_fail_high", () => {
		const f = deriveMatchProbeFindings(baseAgg({ recoveryFailRate: 0.3 }));
		expect(f.map((x) => x.id)).toContain("recovery_fail_high");
	});

	it("pad_seek_starved", () => {
		const f = deriveMatchProbeFindings(
			baseAgg({ avgBoostFuel: 0.1, avgPadSeeks: 0.1 }),
		);
		expect(f.map((x) => x.id)).toContain("pad_seek_starved");
	});

	it("formatFindingsMarkdown zawiera tytuł", () => {
		const agg = baseAgg({ kickoffDiagonalFailRate: 1 });
		const findings = deriveMatchProbeFindings(agg);
		const md = formatFindingsMarkdown(findings, agg);
		expect(md).toContain("Match Probe");
		expect(md).toContain("Kickoff nie jest diagonalny");
	});
});
