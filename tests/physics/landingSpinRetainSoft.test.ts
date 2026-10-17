import { describe, expect, it } from "vitest";
import { RL_CAR } from "../../src/util/rlConstants";

describe("soft landing spin retain", () => {
	it("spin retain ≥0.85 (mniej hard-kill ω przy lądowaniu)", () => {
		expect(RL_CAR.landingSpinRetain).toBeGreaterThanOrEqual(0.85);
		expect(RL_CAR.landingSpinRetain).toBeLessThanOrEqual(0.95);
	});
});
