import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("soft chase FOV / look-back", () => {
	it("boost FOV punch ≤0.42 (pro: no camera shake / soft pull)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/cameraFollow.ts"),
			"utf8",
		);
		expect(src).toMatch(/boostT\s*\*\s*\(lowInFrame\s*\?\s*0\.04\s*:\s*0\.38\)/);
		expect(src).toMatch(/fovSpeedT\s*\*\s*0\.22/);
	});

	it("look-back damp łagodniejszy niż snap (rate ≤36)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/Renderer.ts"),
			"utf8",
		);
		const i = src.indexOf("this.lookBackBlendT = THREE.MathUtils.damp");
		expect(i).toBeGreaterThan(0);
		const slice = src.slice(i, i + 180);
		const m = slice.match(/,\s*(\d+)\s*,\s*dt/);
		expect(m).not.toBeNull();
		expect(Number(m![1])).toBeLessThanOrEqual(36);
		expect(Number(m![1])).toBeGreaterThanOrEqual(20);
	});
});
