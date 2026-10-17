import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	halfForBallZ,
	MERIDIAN_CROSS_BURST,
	MERIDIAN_DEADZONE_Z,
	MERIDIAN_POINTS_PER_SEC,
	MeridianController,
} from "../../src/modes/MeridianController";

describe("MeridianController", () => {
	it("halfForBallZ uses deadzone around midfield", () => {
		expect(halfForBallZ(0)).toBe("neutral");
		expect(halfForBallZ(MERIDIAN_DEADZONE_Z)).toBe("neutral");
		expect(halfForBallZ(MERIDIAN_DEADZONE_Z + 0.01)).toBe("orange");
		expect(halfForBallZ(-(MERIDIAN_DEADZONE_Z + 0.01))).toBe("blue");
	});

	it("awards blue points while ball is on orange half", () => {
		const ctrl = new MeridianController(true);
		const pos = new THREE.Vector3(0, 1, 8);
		const a = ctrl.update(0.5, pos, true);
		expect(a.blueDelta).toBe(Math.floor(MERIDIAN_POINTS_PER_SEC * 0.5));
		expect(a.orangeDelta).toBe(0);
		expect(a.cross).toBeNull();
	});

	it("awards orange points while ball is on blue half", () => {
		const ctrl = new MeridianController(true);
		const pos = new THREE.Vector3(0, 1, -8);
		const a = ctrl.update(1, pos, true);
		expect(a.orangeDelta).toBe(MERIDIAN_POINTS_PER_SEC);
		expect(a.blueDelta).toBe(0);
	});

	it("ignores deadzone and kickoff (scoringActive=false)", () => {
		const ctrl = new MeridianController(true);
		const mid = new THREE.Vector3(0, 1, 0);
		expect(ctrl.update(1, mid, true)).toEqual({
			blueDelta: 0,
			orangeDelta: 0,
			cross: null,
		});
		const far = new THREE.Vector3(0, 1, 10);
		expect(ctrl.update(1, far, false).blueDelta).toBe(0);
		expect(ctrl.getLivePossession(10, 5)).toBeNull();
	});

	it("fires equator cross burst when half flips", () => {
		const ctrl = new MeridianController(true);
		ctrl.update(0.05, new THREE.Vector3(0, 1, 5), true);
		const crossTick = ctrl.update(0.05, new THREE.Vector3(0, 1, -5), true);
		expect(crossTick.cross).not.toBeNull();
		expect(crossTick.cross?.scoringTeam).toBe("orange");
		expect(crossTick.cross?.to).toBe("blue");
		expect(crossTick.orangeDelta).toBeGreaterThanOrEqual(MERIDIAN_CROSS_BURST);
	});

	it("live possession exposes fractional total for scoring team", () => {
		const ctrl = new MeridianController(true);
		const tick = ctrl.update(0.3, new THREE.Vector3(0, 1, 8), true);
		expect(tick.blueDelta).toBe(1);
		const live = ctrl.getLivePossession(12 + tick.blueDelta, 3);
		expect(live?.team).toBe("blue");
		expect(live?.liveTotal).toBeCloseTo(
			12 + tick.blueDelta + (MERIDIAN_POINTS_PER_SEC * 0.3 - tick.blueDelta),
			5,
		);
	});

	it("disabled controller is a no-op", () => {
		const ctrl = new MeridianController(false);
		const r = ctrl.update(1, new THREE.Vector3(0, 1, 10), true);
		expect(r.blueDelta).toBe(0);
		expect(r.cross).toBeNull();
	});
});
