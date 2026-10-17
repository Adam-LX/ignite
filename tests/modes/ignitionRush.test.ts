import { describe, expect, it } from "vitest";

import { IgnitionRushController } from "../../src/modes/IgnitionRushController";

describe("IgnitionRushController", () => {
	it("disabled controller is inert", () => {
		const rush = new IgnitionRushController(false);
		rush.update(120, true);
		expect(rush.isRushActive()).toBe(false);
		expect(rush.getBallSpeedMul()).toBe(1);
	});

	it("enters rush after interval while playing", () => {
		const rush = new IgnitionRushController(true, {
			intervalSec: 10,
			durationSec: 5,
		});
		rush.update(10, true);
		expect(rush.isRushActive()).toBe(true);
		expect(rush.getBallSpeedMul()).toBeGreaterThan(1);
	});

	it("returns to normal after rush duration", () => {
		const rush = new IgnitionRushController(true, {
			intervalSec: 10,
			durationSec: 5,
		});
		rush.update(10, true);
		rush.update(5, true);
		expect(rush.isRushActive()).toBe(false);
		expect(rush.snapshot().nextRushInSec).toBeCloseTo(10, 5);
	});
});
