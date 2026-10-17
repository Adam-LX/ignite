import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { OPTICS_RECIPES } from "../../src/visual/optics/opticsRecipes";
import { LIGHTING_FILM_NIGHT } from "../../src/visual/lighting";

describe("path-trace look knobs (CP2077-readable)", () => {
	it("match.high: selective bloom + controlled fill (readable contrast)", () => {
		const r = OPTICS_RECIPES["match.high"];
		expect(r.bloom.kernel).toBe("small");
		/** Wysoki threshold = tylko prawdziwe HDR highlighty. */
		expect(r.bloom.threshold).toBeGreaterThanOrEqual(0.88);
		expect(r.bloom.intensity).toBeLessThanOrEqual(0.14);
		expect(r.bloom.intensity).toBeGreaterThan(0.06);
		expect(r.bloom.radius).toBeLessThanOrEqual(0.4);
		expect(r.lights.hemiMul).toBeGreaterThan(0.7);
		expect(r.lights.hemiMul).toBeLessThanOrEqual(0.9);
		expect(r.lights.beamOpacity).toBeLessThanOrEqual(0.18);
		expect(r.lights.ambientMul).toBeLessThanOrEqual(0.5);
		expect(r.grade.exposure).toBeLessThanOrEqual(0.9);
		expect(r.grade.saturation).toBeLessThanOrEqual(1.5);
		expect(r.flares.sourceWeightMul).toBeLessThanOrEqual(1.4);
	});

	it("MatchOpticsDirector aplikuje bloom.radius z recepty + PT spectacle", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/optics/MatchOpticsDirector.ts"),
			"utf8",
		);
		expect(src).toMatch(/mipmapBlurPass\.radius = pathTrace/);
		expect(src).toContain("r.flares.sourceWeightMul");
		expect(src).toContain("isPathTraceLookEnabled");
		expect(src).toContain("pathTrace ? 0.78 : 0.32");
		expect(src).toContain("beamsVisible = false");
		expect(src).toContain("0.82");
	});

	it("night film: greenish ground bounce, muted fill", () => {
		expect(LIGHTING_FILM_NIGHT.hemisphereGround).toBe(0x0e3420);
		expect(LIGHTING_FILM_NIGHT.hemisphereIntensity).toBeGreaterThan(0.12);
		expect(LIGHTING_FILM_NIGHT.hemisphereIntensity).toBeLessThanOrEqual(0.28);
	});

	it("stadiumLighting ma bounceLights w rigu", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/stadiumLighting.ts"),
			"utf8",
		);
		expect(src).toContain("bounceLights");
		expect(src).toContain("bounceGoalBlue");
		expect(src).toContain("Fake path-trace bounce");
	});

	it("match air haze w stadiumAtmosphere", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/stadiumAtmosphere.ts"),
			"utf8",
		);
		expect(src).toContain("matchAirHaze");
		expect(src).toContain("MATCH_HAZE_FRAG");
	});

	it("contact shadows: dual-lobe car + ball", () => {
		const car = readFileSync(
			resolve(__dirname, "../../src/visual/carContactShadow.ts"),
			"utf8",
		);
		const ball = readFileSync(
			resolve(__dirname, "../../src/visual/ballShadow.ts"),
			"utf8",
		);
		expect(car).toContain("dual-lobe");
		expect(car).toContain("penumbra");
		expect(car).toContain("isPathTraceLookEnabled");
		expect(ball).toContain("dual-lobe");
		expect(ball).toContain("penumbra");
		expect(ball).toContain("isPathTraceLookEnabled");
	});

	it("ballVfx: groundFill na murawę przy PT", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/vfx/ballVfx.ts"),
			"utf8",
		);
		expect(src).toContain("ballGroundFill");
		expect(src).toContain("isPathTraceLookEnabled");
	});

	it("pitchWetness: IBL reaguje na pathTraceLook (spektakl vs competitive)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/pitchWetness.ts"),
			"utf8",
		);
		expect(src).toContain("refreshPitchLookForPrefs");
		expect(src).toContain("isPathTraceLookEnabled");
		expect(src).toContain("WET_SPECTACLE");
		expect(src).toContain("DRY_COMPETITIVE");
		expect(src).toContain("0.42 + t * 0.4");
		expect(src).toContain("liftPitchAlbedo");
	});

	it("match.medium: soft PT bloom bez mydła", () => {
		const r = OPTICS_RECIPES["match.medium"];
		expect(r.bloom.kernel).toBe("small");
		expect(r.bloom.threshold).toBeGreaterThanOrEqual(0.9);
		expect(r.bloom.intensity).toBeLessThanOrEqual(0.1);
		expect(r.lights.beamOpacity).toBeLessThanOrEqual(0.14);
	});

	it("cinematic knee: earlier highlight roll-off", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/cinematicPostFx.ts"),
			"utf8",
		);
		expect(src).toContain("kneeStart = mix(0.86, 0.74, skyProt)");
		expect(src).toContain("(peak - kneeStart) * 2.65");
	});

	it("ACES tonemap: tighter whitePoint for highlight control", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/premiumPostStack.ts"),
			"utf8",
		);
		expect(src).toContain("whitePoint: 2.75");
		expect(src).toContain("middleGrey: 0.45");
		expect(src).toContain("matchLook ? 0.08");
	});

	it("MatchColorGrade: agresywniejszy highlight cap", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/MatchColorGradeShader.ts"),
			"utf8",
		);
		expect(src).toContain("skyCap = mix(1.05, 0.82");
	});

	it("MatchOpticsDirector: flood + focus boost bounce GI", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/optics/MatchOpticsDirector.ts"),
			"utf8",
		);
		expect(src).toContain("getArenaBallFocus");
		expect(src).toContain("flood.mix * 1.15");
		expect(src).toContain("mipmapBlurPass.enabled");
		expect(src).toContain("mode === \"match\" ? 0.04");
		expect(src).toContain("isPathTraceLookEnabled");
	});
});
