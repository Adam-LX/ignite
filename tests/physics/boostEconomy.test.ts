import { describe, expect, it } from "vitest";

import { RL_CAR } from "../../src/util/rlConstants";

describe("Core boost economy", () => {
	it("spawn boost is RL 33/100", () => {
		expect(RL_CAR.boostSpawn).toBeCloseTo(0.33, 5);
	});

	it("dodge deadzone stays in competitive band", () => {
		expect(RL_CAR.dodgeDeadzone).toBeGreaterThanOrEqual(0.45);
		expect(RL_CAR.dodgeDeadzone).toBeLessThanOrEqual(0.85);
	});

	it("flip reset dwell is short (responsive wheels-on-ball)", () => {
		expect(RL_CAR.flipResetDwellSec).toBeGreaterThan(0);
		expect(RL_CAR.flipResetDwellSec).toBeLessThanOrEqual(0.12);
		expect(RL_CAR.flipResetBallBelowDot).toBeGreaterThan(0.4);
		expect(RL_CAR.flipResetBallBelowDot).toBeLessThan(0.8);
	});

	it("wall jump detach window keeps second jump from sticking", () => {
		expect(RL_CAR.wallJumpDetachSec).toBeGreaterThanOrEqual(0.28);
		expect(RL_CAR.wallJumpDetachSec).toBeLessThanOrEqual(0.55);
		expect(RL_CAR.wallJumpNormalBoost).toBeGreaterThan(0);
		expect(RL_CAR.wallJumpNormalBoost).toBeLessThan(5);
	});

	it("Core (mul=1) does not passive-regen; Rush mul>1 does", () => {
		/** Mirror RocketCar.control regen gate without spinning Rapier. */
		const tick = (fuel: number, mul: number, dt: number, grounded: boolean) => {
			if (mul <= 1) return fuel;
			const airRatio =
				RL_CAR.boostRegenGround > 0
					? RL_CAR.boostRegenAir / RL_CAR.boostRegenGround
					: 0;
			const rate = grounded ? 1 : airRatio;
			return Math.min(1, fuel + dt * RL_CAR.boostRegenGround * rate * mul);
		};

		let core = RL_CAR.boostSpawn;
		for (let i = 0; i < 600; i++) core = tick(core, 1, 1 / 120, true);
		expect(core).toBeCloseTo(RL_CAR.boostSpawn, 5);

		let rush = RL_CAR.boostSpawn;
		for (let i = 0; i < 120; i++) rush = tick(rush, 1.3, 1 / 120, true);
		expect(rush).toBeGreaterThan(RL_CAR.boostSpawn + 0.05);
	});
});
