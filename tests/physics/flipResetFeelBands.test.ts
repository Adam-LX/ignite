import { describe, expect, it } from "vitest";
import { RL_CAR } from "../../src/util/rlConstants";

/**
 * RL reference: soft undercarriage dwell, feather before contact.
 * Flip reset must feel snappy (short dwell) with cooldown against spam.
 */
describe("flip reset feel bands", () => {
	it("dwell krótki, cooldown przeciw spamowi, soft below-dot", () => {
		expect(RL_CAR.flipResetDwellSec).toBeGreaterThanOrEqual(0.03);
		expect(RL_CAR.flipResetDwellSec).toBeLessThanOrEqual(0.08);
		expect(RL_CAR.flipResetCooldownSec).toBeGreaterThanOrEqual(0.25);
		expect(RL_CAR.flipResetCooldownSec).toBeLessThanOrEqual(0.6);
		expect(RL_CAR.flipResetBallBelowDot).toBeGreaterThanOrEqual(0.45);
		expect(RL_CAR.flipResetBallBelowDot).toBeLessThanOrEqual(0.7);
		expect(RL_CAR.flipResetDistSlack).toBeGreaterThan(0);
		expect(RL_CAR.flipResetDistSlack).toBeLessThanOrEqual(0.25);
	});

	it("wavedash window overlaps early flip land", () => {
		expect(RL_CAR.waveDashMinFlipElapsed).toBeLessThan(
			RL_CAR.waveDashMaxFlipElapsed,
		);
		expect(RL_CAR.waveDashMaxFlipElapsed).toBeLessThanOrEqual(0.35);
		expect(RL_CAR.waveDashSpeedBoost).toBeGreaterThan(1.5);
	});
});
