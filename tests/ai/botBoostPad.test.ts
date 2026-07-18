import { describe, expect, it } from "vitest";

import {
	pickNearestBoostPad,
	shouldSeekBoostPad,
} from "../../src/ai/botTactics";

describe("botTactics — boost pad economy", () => {
	const pads = [
		{ x: 10, z: 0, big: false, active: true },
		{ x: 40, z: 0, big: true, active: true },
		{ x: 5, z: 5, big: false, active: false },
	];

	it("pickNearestBoostPad — najbliższy aktywny", () => {
		const pad = pickNearestBoostPad(0, 0, pads);
		expect(pad?.x).toBe(10);
		expect(pad?.big).toBe(false);
	});

	it("pickNearestBoostPad — preferBig skraca koszt big", () => {
		const pad = pickNearestBoostPad(0, 0, pads, { preferBig: true });
		expect(pad?.big).toBe(true);
		expect(pad?.x).toBe(40);
	});

	it("shouldSeekBoostPad — nie podczas kickoff / threat; critical override loose", () => {
		expect(
			shouldSeekBoostPad(0.1, {
				kickoffChase: true,
				ownGoalThreat: false,
				looseBall: false,
				role: "striker",
				ballDist: 40,
			}),
		).toBe(false);
		expect(
			shouldSeekBoostPad(0.1, {
				kickoffChase: false,
				ownGoalThreat: true,
				looseBall: false,
				role: "striker",
				ballDist: 40,
			}),
		).toBe(false);
		/** Fuel krytyczny — zawsze pad (nawet przy piłce). */
		expect(
			shouldSeekBoostPad(0.1, {
				kickoffChase: false,
				ownGoalThreat: false,
				looseBall: true,
				role: "striker",
				ballDist: 4,
			}),
		).toBe(true);
		expect(
			shouldSeekBoostPad(0.1, {
				kickoffChase: false,
				ownGoalThreat: false,
				looseBall: true,
				role: "striker",
				ballDist: 10,
			}),
		).toBe(true);
	});

	it("shouldSeekBoostPad — support przy niskim fuel", () => {
		expect(
			shouldSeekBoostPad(0.25, {
				kickoffChase: false,
				ownGoalThreat: false,
				looseBall: false,
				role: "support",
				ballDist: 15,
			}),
		).toBe(true);
		expect(
			shouldSeekBoostPad(0.5, {
				kickoffChase: false,
				ownGoalThreat: false,
				looseBall: false,
				role: "support",
				ballDist: 15,
			}),
		).toBe(false);
	});

	it("shouldSeekBoostPad — striker tylko gdy sucho lub piłka daleko", () => {
		expect(
			shouldSeekBoostPad(0.3, {
				kickoffChase: false,
				ownGoalThreat: false,
				looseBall: false,
				role: "striker",
				ballDist: 12,
			}),
		).toBe(false);
		expect(
			shouldSeekBoostPad(0.3, {
				kickoffChase: false,
				ownGoalThreat: false,
				looseBall: false,
				role: "striker",
				ballDist: 35,
			}),
		).toBe(true);
		expect(
			shouldSeekBoostPad(0.15, {
				kickoffChase: false,
				ownGoalThreat: false,
				looseBall: false,
				role: "striker",
				ballDist: 12,
			}),
		).toBe(true);
	});
});
