import { describe, expect, it } from "vitest";

import { IgnitionRushController } from "../../src/modes/IgnitionRushController";
import {
	resolveIgnitionStorm,
	stormBallSpeedMul,
	stormBoostRegenMul,
} from "../../src/modes/IgnitionStorm";
import { TeamOvercharge } from "../../src/modes/TeamOvercharge";

describe("IgnitionStorm", () => {
	it("nieaktywny gdy brak Rush lub OC", () => {
		const rush = new IgnitionRushController(true);
		const oc = new TeamOvercharge(true);
		expect(resolveIgnitionStorm(rush, oc).active).toBe(false);

		oc.trigger("blue");
		expect(resolveIgnitionStorm(rush, oc).active).toBe(false);
	});

	it("aktywny gdy Rush ∩ Overcharge", () => {
		const rush = new IgnitionRushController(true, {
			intervalSec: 1,
			durationSec: 20,
		});
		const oc = new TeamOvercharge(true);
		rush.update(1, true);
		expect(rush.isRushActive()).toBe(true);
		oc.trigger("orange");
		const storm = resolveIgnitionStorm(rush, oc);
		expect(storm.active).toBe(true);
		expect(storm.team).toBe("orange");
		expect(storm.intensity).toBeGreaterThanOrEqual(0.55);
	});

	it("soft-cap mulów", () => {
		const storm = {
			active: true as const,
			team: "blue" as const,
			intensity: 1,
		};
		expect(stormBallSpeedMul(1.45, storm)).toBeLessThanOrEqual(1.55);
		expect(stormBoostRegenMul(2.0, storm)).toBeLessThanOrEqual(2.15);
		expect(stormBallSpeedMul(1.2, { active: false, team: null, intensity: 0 })).toBe(
			1.2,
		);
	});
});
