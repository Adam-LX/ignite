import { describe, expect, it } from "vitest";

import {
	LIGHTING_FILM_DUSK,
	LIGHTING_FILM_NIGHT,
	getActiveLightingFilm,
	sampleLightingFilm,
	setActiveLightingFilm,
} from "../../src/visual/lighting";

describe("lighting film profiles", () => {
	it("sampleLightingFilm(0) ≈ dusk", () => {
		const f = sampleLightingFilm(0);
		expect(f.ambientIntensity).toBeCloseTo(LIGHTING_FILM_DUSK.ambientIntensity);
		expect(f.hemisphereIntensity).toBeCloseTo(
			LIGHTING_FILM_DUSK.hemisphereIntensity,
		);
	});

	it("sampleLightingFilm(1) ≈ night", () => {
		const f = sampleLightingFilm(1);
		expect(f.ambientIntensity).toBeCloseTo(
			LIGHTING_FILM_NIGHT.ambientIntensity,
		);
		expect(f.hemisphereIntensity).toBeCloseTo(
			LIGHTING_FILM_NIGHT.hemisphereIntensity,
		);
	});

	it("setActiveLightingFilm night/dusk", () => {
		expect(setActiveLightingFilm("night")).toBe("night");
		expect(getActiveLightingFilm().ambientIntensity).toBe(
			LIGHTING_FILM_NIGHT.ambientIntensity,
		);
		expect(setActiveLightingFilm("dusk")).toBe("dusk");
		expect(getActiveLightingFilm().ambientIntensity).toBe(
			LIGHTING_FILM_DUSK.ambientIntensity,
		);
	});

	it("blend jest między dusk a night", () => {
		const mid = sampleLightingFilm(0.5);
		expect(mid.ambientIntensity).toBeGreaterThan(
			LIGHTING_FILM_NIGHT.ambientIntensity,
		);
		expect(mid.ambientIntensity).toBeLessThan(
			LIGHTING_FILM_DUSK.ambientIntensity,
		);
	});
});
