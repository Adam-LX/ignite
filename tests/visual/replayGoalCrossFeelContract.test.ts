import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "../../src/Renderer.ts"), "utf8");

describe("replay goal-cross FOV/shake (pro soft)", () => {
	it("cross pulse FOV ≤6 i shake ≤0.16", () => {
		const i = src.indexOf("replayGoalCrossPulsed = true");
		expect(i).toBeGreaterThan(0);
		const slice = src.slice(i, i + 280);
		expect(slice).toMatch(/goalFovBoost,\s*6\)/);
		expect(slice).toMatch(/shakeIntensity,\s*0\.14/);
	});
});
