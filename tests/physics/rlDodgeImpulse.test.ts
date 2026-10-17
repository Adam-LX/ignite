import { describe, expect, it } from "vitest";

import {
	rlDodgeImpulseComponentsMps,
	rlFlipCancelPitchScale,
	rlFlipRelTorque,
} from "../../src/util/rlPhysics";

describe("rlDodgeImpulseComponentsMps (RocketSim)", () => {
	it("frontflip stoi — ~5 m/s do przodu", () => {
		const { alongFwd, alongSide } = rlDodgeImpulseComponentsMps(
			{ throttle: 1, yaw: 0 },
			0,
		);
		expect(alongFwd).toBeCloseTo(5, 2);
		expect(alongSide).toBeCloseTo(0, 2);
	});

	it("frontflip z ghost yaw — bez składowej bocznej", () => {
		const { alongFwd, alongSide } = rlDodgeImpulseComponentsMps(
			{ throttle: 1, yaw: 0.15 },
			0,
		);
		expect(alongFwd).toBeCloseTo(5, 2);
		expect(alongSide).toBeCloseTo(0, 2);
	});

	it("backflip przy jeździe do przodu — hamuje mocniej", () => {
		const slow = rlDodgeImpulseComponentsMps({ throttle: -1, yaw: 0 }, 0);
		const fast = rlDodgeImpulseComponentsMps({ throttle: -1, yaw: 0 }, 2300);
		expect(slow.alongFwd).toBeLessThan(0);
		expect(Math.abs(fast.alongFwd)).toBeGreaterThan(Math.abs(slow.alongFwd));
		expect(Math.abs(fast.alongFwd)).toBeGreaterThan(10);
	});

	it("diagonal — składowa boczna skaluje się z prędkością", () => {
		const slow = rlDodgeImpulseComponentsMps({ throttle: 1, yaw: 1 }, 0);
		const fast = rlDodgeImpulseComponentsMps({ throttle: 1, yaw: 1 }, 2300);
		expect(Math.abs(fast.alongSide)).toBeGreaterThan(Math.abs(slow.alongSide));
	});
});

describe("rlFlipRelTorque", () => {
	it("frontflip — pitch dodatni (nose-down torque)", () => {
		const { pitch, roll } = rlFlipRelTorque({ throttle: 1, yaw: 0 });
		expect(pitch).toBeCloseTo(1, 2);
		expect(roll).toBeCloseTo(0, 2);
	});

	it("dominant axis — W z ghost yaw nie dodaje roll", () => {
		const { pitch, roll } = rlFlipRelTorque({ throttle: 1, yaw: 0.15 });
		expect(pitch).toBeCloseTo(1, 2);
		expect(roll).toBeCloseTo(0, 2);
	});

	it("sideflip — yaw z ghost W nie dodaje pitch", () => {
		const { pitch, roll } = rlFlipRelTorque({ throttle: 0.15, yaw: 1 });
		expect(pitch).toBeCloseTo(0, 2);
		expect(roll).toBeCloseTo(-1, 2);
	});
});

describe("rlFlipCancelPitchScale", () => {
	it("brak cancel w pierwszych 5 tickach", () => {
		expect(rlFlipCancelPitchScale(1, -1, 0.02, 5 / 120)).toBe(1);
	});

	it("pełny cancel przy tym samym znaku pitch po grace (RL)", () => {
		expect(rlFlipCancelPitchScale(1, 1, 0.2, 5 / 120)).toBe(0);
	});
});
