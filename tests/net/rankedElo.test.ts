import { describe, expect, it } from "vitest";

import {
	applyRankedMatch,
	eloDelta,
	expectedScore,
	rankedForfeitScores,
} from "../../server/rankedElo";

describe("ranked ELO", () => {
	it("expectedScore jest symetryczny wokół 0.5", () => {
		const a = expectedScore(1200, 1200);
		expect(a).toBeCloseTo(0.5, 5);
		expect(expectedScore(1400, 1200)).toBeGreaterThan(0.5);
		expect(expectedScore(1200, 1400)).toBeLessThan(0.5);
	});

	it("faworyt zyskuje mniej punktów", () => {
		const upset = eloDelta(1000, 1200);
		const expected = eloDelta(1200, 1000);
		expect(upset).toBeGreaterThan(expected);
	});

	it("applyRankedMatch aktualizuje obu graczy", () => {
		const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const out = applyRankedMatch({
			hostClientId: `host_${suffix}`,
			guestClientId: `guest_${suffix}`,
			blueScore: 3,
			orangeScore: 1,
		});
		expect(out.host.matches).toBe(1);
		expect(out.guest.matches).toBe(1);
		expect(out.host.wins + out.guest.wins).toBe(1);
		expect(out.hostDelta).toBeGreaterThan(0);
		expect(out.guestDelta).toBeLessThan(0);
	});

	it("rankedForfeitScores daje 3–0 zwycięzcy", () => {
		expect(rankedForfeitScores(0)).toEqual({ blueScore: 0, orangeScore: 3 });
		expect(rankedForfeitScores(1)).toEqual({ blueScore: 3, orangeScore: 0 });
	});
});
