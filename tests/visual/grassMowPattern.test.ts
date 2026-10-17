import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	GRASS_MOW_BAND_METERS,
	GRASS_MOW_CONTRAST,
	installGrassMowPattern,
} from "../../src/visual/grassMowPattern";

describe("grassMowPattern", () => {
	it("ustawia customProgramCacheKey i onBeforeCompile", () => {
		const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
		installGrassMowPattern(mat);
		expect(mat.customProgramCacheKey?.()).toBe(
			"flyball-grass-mow-v23-readable",
		);
		expect(mat.onBeforeCompile).toBeTypeOf("function");
	});

	it("proste pasy stadionowe — szerokość i kontrast RL/PL", () => {
		expect(GRASS_MOW_BAND_METERS).toBeGreaterThan(1.8);
		expect(GRASS_MOW_BAND_METERS).toBeLessThan(3.5);
		expect(GRASS_MOW_CONTRAST).toBeGreaterThan(0.15);
		expect(GRASS_MOW_CONTRAST).toBeLessThan(0.45);
	});

	it("shader: parallel Z stripes + view-dependent bend (nie elipsy)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/grassMowPattern.ts"),
			"utf8",
		);
		expect(src).toContain("xz.y / uMowBandWidth");
		expect(src).toContain("towardCam");
		expect(src).toContain("bendSign");
		expect(src).toContain("roughnessFactor");
		expect(src).toContain("intoLight");
		expect(src).toContain("wetPatch");
		expect(src).toContain("wetLocal");
		expect(src).not.toContain("rEllipse");
	});
});
