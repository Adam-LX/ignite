import { describe, expect, it, beforeEach } from "vitest";

import { makeCosmeticRef } from "../../src/meta/CosmeticCatalog";
import {
	getInstanceProvenance,
	getUnlockedInstances,
	resetPlayerInventoryForTests,
	unlockInstance,
} from "../../src/meta/PlayerInventory";
import {
	getTeamPit,
	resetTeamPitForTests,
	setTeamPitFocus,
	setTeamPitSlot,
	syncTeamPitEquippedCar,
} from "../../src/meta/teamPit";

describe("provenance", () => {
	beforeEach(() => {
		resetPlayerInventoryForTests();
	});

	it("stores provenance on unlock", () => {
		const painted = makeCosmeticRef("car", "octane", "lime");
		const ok = unlockInstance(painted, true, {
			source: "match_drop",
			arenaId: "standard",
			unlockedAt: 123,
		});
		expect(ok).toBe(true);
		const stored = getUnlockedInstances("car").find(
			(i) => i.itemId === "octane" && i.paintId === "lime",
		);
		expect(stored).toBeTruthy();
		expect(stored!.provenance).toEqual({
			source: "match_drop",
			arenaId: "standard",
			unlockedAt: 123,
		});
	});

	it("default unlocks get default provenance", () => {
		const cars = getUnlockedInstances("car");
		expect(cars.length).toBeGreaterThan(0);
		expect(cars[0]?.provenance?.source).toBe("default");
	});
});

describe("teamPit", () => {
	beforeEach(() => {
		resetPlayerInventoryForTests();
		resetTeamPitForTests();
	});

	it("has 3 slots and focus changes", () => {
		const pit = getTeamPit();
		expect(pit.slots).toHaveLength(3);
		setTeamPitFocus(2);
		expect(getTeamPit().focusSlot).toBe(2);
	});

	it("syncs slot 0 with equipped car", () => {
		syncTeamPitEquippedCar("octane");
		expect(getTeamPit().slots[0]).toBe("octane");
		setTeamPitSlot(1, "octane", { focus: true });
		expect(getTeamPit().focusSlot).toBe(1);
	});
});
