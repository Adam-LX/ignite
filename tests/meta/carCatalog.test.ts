import { describe, expect, it, beforeEach } from "vitest";

import {
	FALLBACK_CATALOG,
	getCarEntry,
	getCarRarity,
	getDefaultCarId,
	getDroppableCarIds,
	resolveCarId,
} from "../../src/meta/CarCatalog";

describe("CarCatalog", () => {
	it("fallback ma octane jako domyślne", () => {
		expect(getDefaultCarId()).toBe("octane");
		expect(getCarEntry("octane")?.defaultUnlocked).toBe(true);
	});

	it("resolveCarId fallbackuje nieznane id", () => {
		expect(resolveCarId("unknown")).toBe("octane");
		expect(resolveCarId("muscle")).toBe("muscle");
	});

	it("droppable cars nie zawierają octane", () => {
		const drop = getDroppableCarIds();
		expect(drop).toContain("muscle");
		expect(drop).not.toContain("octane");
	});

	it("fallback catalog ma 3 auta", () => {
		expect(FALLBACK_CATALOG.cars.length).toBeGreaterThanOrEqual(2);
		expect(FALLBACK_CATALOG.hitboxProfile).toBe("octane");
	});

	it("rarity z katalogu", () => {
		expect(getCarRarity("octane")).toBe("common");
		expect(getCarRarity("muscle")).toBe("rare");
		expect(getCarRarity("sleek")).toBe("epic");
	});
});
