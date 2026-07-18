import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
	GRASS_MOW_BAND_METERS,
	GRASS_MOW_CONTRAST,
	installGrassMowPattern,
} from "../../src/visual/grassMowPattern";

describe("grassMowPattern", () => {
	it("ustawia customProgramCacheKey i onBeforeCompile", () => {
		const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
		installGrassMowPattern(mat);
		expect(mat.customProgramCacheKey?.()).toBe("flyball-grass-mow-v1");
		expect(mat.onBeforeCompile).toBeTypeOf("function");
	});

	it("stałe pasów w rozsądnym zakresie", () => {
		expect(GRASS_MOW_BAND_METERS).toBeGreaterThan(1.2);
		expect(GRASS_MOW_BAND_METERS).toBeLessThan(2.5);
		expect(GRASS_MOW_CONTRAST).toBeGreaterThan(0.05);
		expect(GRASS_MOW_CONTRAST).toBeLessThan(0.2);
	});
});
