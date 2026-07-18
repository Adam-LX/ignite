import { describe, expect, it } from "vitest";

import { TeamOvercharge } from "../../src/modes/TeamOvercharge";
import {
	getMatchBallSpeedMul,
	setMatchBallSpeedMul,
} from "../../src/util/rlContacts";
import { IgnitionRushController } from "../../src/modes/IgnitionRushController";

describe("TeamOvercharge", () => {
	it("fills charge and auto-triggers at 1.0", () => {
		const oc = new TeamOvercharge(true, { activeSec: 8, cooldownSec: 45 });
		for (let i = 0; i < 13; i++) oc.addCharge("blue", "save");
		expect(oc.isActive("blue")).toBe(true);
		expect(oc.getCharge("blue")).toBe(0);
		expect(oc.snapshot().activeLeftSec).toBeCloseTo(8, 5);
	});

	it("blocks own charge while active or on cooldown; opponent may charge", () => {
		const oc = new TeamOvercharge(true, { activeSec: 2, cooldownSec: 5 });
		oc.trigger("orange");
		oc.addCharge("orange", "demo");
		expect(oc.getCharge("orange")).toBe(0);
		oc.addCharge("blue", "demo");
		expect(oc.getCharge("blue")).toBeCloseTo(0.12, 5);
		oc.update(2.1, true);
		expect(oc.isActive()).toBe(false);
		oc.addCharge("orange", "demo");
		expect(oc.getCharge("orange")).toBe(0);
		oc.update(5, true);
		oc.addCharge("orange", "demo");
		expect(oc.getCharge("orange")).toBeCloseTo(0.12, 5);
	});

	it("queues full charge until opponent OC ends", () => {
		const oc = new TeamOvercharge(true, { activeSec: 2, cooldownSec: 5 });
		oc.trigger("orange");
		for (let i = 0; i < 13; i++) oc.addCharge("blue", "save");
		expect(oc.getCharge("blue")).toBe(1);
		expect(oc.isActive("blue")).toBe(false);
		oc.update(2.1, true);
		expect(oc.isActive("blue")).toBe(true);
	});

	it("disabled controller ignores charge", () => {
		const oc = new TeamOvercharge(false);
		oc.addCharge("blue", "save");
		expect(oc.getCharge("blue")).toBe(0);
	});
});

describe("rush ball speed mul", () => {
	it("exposes mul only while rush active", () => {
		const rush = new IgnitionRushController(true, {
			intervalSec: 5,
			durationSec: 3,
			ballSpeedMul: 1.25,
		});
		expect(rush.getBallSpeedMul()).toBe(1);
		rush.update(5, true);
		expect(rush.getBallSpeedMul()).toBe(1.25);
		setMatchBallSpeedMul(rush.getBallSpeedMul());
		expect(getMatchBallSpeedMul()).toBe(1.25);
		rush.update(3, true);
		setMatchBallSpeedMul(rush.getBallSpeedMul());
		expect(getMatchBallSpeedMul()).toBe(1);
	});
});
