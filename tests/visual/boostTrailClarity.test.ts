import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("boost trail clarity (readable PT)", () => {
	it("ground segment opacityBase ≤0.5 przy boost", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/vfx/boostTrail.ts"),
			"utf8",
		);
		expect(src).toMatch(
			/opacityBase\s*=\s*boosting\s*\?\s*0\.48\s*:\s*supersonic\s*\?\s*0\.46/,
		);
	});

	it("air ribbon opacity przy boost ≤0.65", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/vfx/boostTrail.ts"),
			"utf8",
		);
		expect(src).toMatch(
			/airMat\.uniforms\.uOpacity!\.value\s*=\s*0\.62/,
		);
	});

	it("trail rzuca PointLight na murawę (nie tylko flat additive)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/vfx/boostTrail.ts"),
			"utf8",
		);
		expect(src).toContain("boostTrailHeadLight");
		expect(src).toContain("boostTrailBodyLight");
		expect(src).toContain("updateTrailLights");
	});
});
