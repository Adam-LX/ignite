import { describe, expect, it } from "vitest";

import {
	isRankedEligibleMode,
	isValidMpSlot,
	MP_MAX_SLOTS,
	MP_SLOTS_PER_TEAM,
	SNAPSHOT_EVERY_PHYSICS_TICKS,
	SNAPSHOT_RATE_HZ,
	teamForSlot,
} from "../../src/net/protocol";
import { RL_CAR } from "../../src/util/rlConstants";

describe("protocol slots", () => {
	it("MP_MAX_SLOTS = 8", () => {
		expect(MP_MAX_SLOTS).toBe(8);
		expect(MP_SLOTS_PER_TEAM).toBe(2);
	});

	it("teamForSlot 1v1 — slot 0 blue, slot 1 orange", () => {
		expect(teamForSlot(0, "1v1")).toBe("blue");
		expect(teamForSlot(1, "1v1")).toBe("orange");
	});

	it("teamForSlot 2v2 — blue 0–1, orange 2–3", () => {
		expect(teamForSlot(0, "2v2")).toBe("blue");
		expect(teamForSlot(1, "2v2")).toBe("blue");
		expect(teamForSlot(2, "2v2")).toBe("orange");
		expect(teamForSlot(3, "2v2")).toBe("orange");
	});

	it("teamForSlot 3v3 — blue 0–2, orange 3–5", () => {
		expect(teamForSlot(0, "3v3")).toBe("blue");
		expect(teamForSlot(2, "3v3")).toBe("blue");
		expect(teamForSlot(3, "3v3")).toBe("orange");
		expect(teamForSlot(5, "3v3")).toBe("orange");
	});

	it("isValidMpSlot 0..7", () => {
		expect(isValidMpSlot(0)).toBe(true);
		expect(isValidMpSlot(7)).toBe(true);
		expect(isValidMpSlot(8)).toBe(false);
		expect(isValidMpSlot(-1)).toBe(false);
	});

	it("isRankedEligibleMode", () => {
		expect(isRankedEligibleMode("1v1")).toBe(true);
		expect(isRankedEligibleMode("2v2")).toBe(true);
		expect(isRankedEligibleMode("3v3")).toBe(false);
	});

	it("snapshot co 2 ticki fizyki (120 Hz → 60 Hz)", () => {
		expect(SNAPSHOT_EVERY_PHYSICS_TICKS).toBe(2);
		expect(SNAPSHOT_RATE_HZ).toBe(RL_CAR.physicsTickHz / 2);
		expect(SNAPSHOT_RATE_HZ).toBe(60);
	});
});
