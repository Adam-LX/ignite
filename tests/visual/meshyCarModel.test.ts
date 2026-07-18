import { describe, expect, it } from "vitest";

import { getMeshyCarModelUrl } from "../../src/visual/meshyArenaAssets";

describe("getMeshyCarModelUrl", () => {
	it("orange — fallback na car_orange.glb gdy brak manifestu", () => {
		const url = getMeshyCarModelUrl("orange");
		expect(url).toContain("car_orange.glb");
	});
});
