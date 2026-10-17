import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rendererSrc = readFileSync(
	resolve(__dirname, "../../src/Renderer.ts"),
	"utf8",
);

describe("Renderer camera shake caps (pro: shake off)", () => {
	it("goal presentation and addCameraShake stay soft", () => {
		expect(rendererSrc).toContain("applyGoalPresentation");
		expect(rendererSrc).toContain("addCameraShake");
		/** Soft caps — continuous RL camera shake is off; event punches stay mild. */
		expect(rendererSrc).toMatch(/Math\.min\(\s*0\.18,/);
		expect(rendererSrc).toMatch(/Math\.min\(\s*0\.22,/);
	});

	it("applyGoalPresentation clamps FOV punch ≤8", () => {
		expect(rendererSrc).toMatch(
			/applyGoalPresentation[\s\S]{0,350}clamp\(\s*fovBoost,\s*0,\s*8\s*\)/,
		);
	});
});
