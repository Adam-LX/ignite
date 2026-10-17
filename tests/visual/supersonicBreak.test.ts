import { describe, expect, it } from "vitest";

import { SupersonicBreak, SUPERSONIC_MPS } from "../../src/visual/supersonicBreak";

describe("SupersonicBreak", () => {
	it("fires only on upward threshold cross", () => {
		const fx = new SupersonicBreak();
		expect(fx.sampleCrossing(SUPERSONIC_MPS - 1)).toBe(false);
		expect(fx.sampleCrossing(SUPERSONIC_MPS + 0.5)).toBe(true);
		expect(fx.sampleCrossing(SUPERSONIC_MPS + 2)).toBe(false);
	});

	it("peaks presentation right after break", () => {
		const fx = new SupersonicBreak();
		fx.sampleCrossing(SUPERSONIC_MPS + 1);
		fx.update(0.02);
		const pres = fx.getPresentation();
		/** Softened SS break (RL shake-off) — still a clear peak. */
		expect(pres.flash).toBeGreaterThan(0.35);
		expect(pres.streak).toBeGreaterThan(0.25);
		expect(pres.shake).toBeLessThanOrEqual(0.05);
		expect(pres.fovBoost).toBeLessThanOrEqual(3.6);
	});
});
