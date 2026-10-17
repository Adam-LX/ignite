import { describe, expect, it } from "vitest";
import {
	FALLBACK_CATALOG,
	setCarCatalogForTests,
} from "../../src/meta/CarCatalog";
import { pickBotCarIds } from "../../src/meta/loadTeamCarTemplates";

describe("bot car models", () => {
	it("assigns distinct catalog cars when enough models exist", () => {
		setCarCatalogForTests(FALLBACK_CATALOG);
		const picks = pickBotCarIds(3, "octane");
		expect(new Set(picks).size).toBeGreaterThan(1);
		expect(picks.every((id) => FALLBACK_CATALOG.cars.some((c) => c.id === id))).toBe(
			true,
		);
	});
});
