import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("AAA next-gen presentation stack", () => {
	it("premiumPostStack wpinaja GTAO/SSGI/SSR/TAA/FSR", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/premiumPostStack.ts"),
			"utf8",
		);
		expect(src).toContain("createAaaNextGenBundle");
		expect(src).toContain("aaa.gtaoPass");
		expect(src).toContain("aaa.ssgiPass");
		expect(src).toContain("aaa.hybridSsrPass");
		expect(src).toContain("aaa.taaPass");
		expect(src).toContain("aaa.fsrPass");
		expect(src).toContain("beginFrame");
		expect(src).toContain("captureHistory");
	});

	it("aaaNextGen ma SSAO/NormalPass + shadery temporal/upscale", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/aaa/aaaNextGen.ts"),
			"utf8",
		);
		expect(src).toContain("SSAOEffect");
		expect(src).toContain("NormalPass");
		expect(src).toContain("HALTON");
		expect(src).toContain("uSharpness");
		expect(src).toContain("Hybrid");
		/** Niestabilne passe domyślnie OFF po regresji Free Cam. */
		expect(src).toMatch(/ssgiPass\.enabled = false/);
		expect(src).toMatch(/hybridSsrPass\.enabled = false/);
		expect(src).toMatch(/taaPass\.enabled = false/);
	});

	it("hybrid pitch weights + flake/rubber materials istnieja", () => {
		const hybrid = readFileSync(
			resolve(
				__dirname,
				"../../src/visual/reflections/PitchHybridReflection.ts",
			),
			"utf8",
		);
		expect(hybrid).toContain("resolveHybridReflectionWeights");
		expect(hybrid).toContain("ssrStrength");

		const flake = readFileSync(
			resolve(__dirname, "../../src/visual/materials/carFlakeMaterial.ts"),
			"utf8",
		);
		expect(flake).toContain("installCarFlakeShader");

		const rubber = readFileSync(
			resolve(__dirname, "../../src/visual/materials/tireRubberMaterial.ts"),
			"utf8",
		);
		expect(rubber).toContain("createTireRubberMaterial");
	});

	it("impact decals używają PLAYFIELD_SURFACE_Y + polygonOffset", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/vfx/impactGroundMark.ts"),
			"utf8",
		);
		expect(src).toContain("PLAYFIELD_SURFACE_Y");
		expect(src).toContain("polygonOffset");
	});
});
