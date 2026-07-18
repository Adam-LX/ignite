import { describe, expect, it } from "vitest";

import { MatchCoachTracker } from "../../src/meta/MatchCoachTracker";

describe("MatchCoachTracker", () => {
	it("counts whiff when close approach misses then peels away", () => {
		const c = new MatchCoachTracker();
		c.tick({
			dt: 0.05,
			ballDist: 2.2,
			closeSpeed: 10,
			boostFuel: 0.5,
			boosting: false,
			speedMps: 12,
			grounded: true,
			ownGoalThreat: false,
			ownGoalDist: 40,
		});
		for (let i = 0; i < 10; i++) {
			c.tick({
				dt: 0.05,
				ballDist: 2.4 + i * 0.4,
				closeSpeed: 2,
				boostFuel: 0.5,
				boosting: false,
				speedMps: 12,
				grounded: true,
				ownGoalThreat: false,
				ownGoalDist: 40,
			});
		}
		const hints = c.summarize();
		expect(hints.some((h) => h.id === "whiff")).toBe(true);
	});

	it("does not count whiff when hit lands", () => {
		const c = new MatchCoachTracker();
		c.tick({
			dt: 0.05,
			ballDist: 2.0,
			closeSpeed: 11,
			boostFuel: 0.5,
			boosting: true,
			speedMps: 14,
			grounded: false,
			ownGoalThreat: false,
			ownGoalDist: 40,
		});
		c.noteBallHit(6);
		c.tick({
			dt: 0.05,
			ballDist: 3.5,
			closeSpeed: 0,
			boostFuel: 0.4,
			boosting: false,
			speedMps: 14,
			grounded: false,
			ownGoalThreat: false,
			ownGoalDist: 40,
		});
		expect(c.summarize().some((h) => h.id === "whiff")).toBe(false);
	});

	it("accumulates boost waste at top speed far from ball", () => {
		const c = new MatchCoachTracker();
		for (let i = 0; i < 40; i++) {
			c.tick({
				dt: 0.05,
				ballDist: 30,
				closeSpeed: 0,
				boostFuel: 0.8,
				boosting: true,
				speedMps: 22,
				grounded: true,
				ownGoalThreat: false,
				ownGoalDist: 40,
			});
		}
		const waste = c.summarize().find((h) => h.id === "boostWaste");
		expect(waste).toBeTruthy();
		expect(waste!.value).toBeGreaterThanOrEqual(1.5);
	});

	it("late save when goal conceded far from net", () => {
		const c = new MatchCoachTracker();
		c.noteGoalConceded({
			ownGoalDist: 28,
			boostFuel: 0.5,
		});
		expect(c.summarize().some((h) => h.id === "lateSave")).toBe(true);
	});
});
