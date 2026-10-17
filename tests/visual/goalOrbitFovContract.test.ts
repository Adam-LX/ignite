import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "../../src/Renderer.ts"), "utf8");

describe("goal orbit FOV punch (pro soft)", () => {
	it("celebration FOV boost capped soft; endGoalOrbit ścina kick", () => {
		expect(src).toMatch(
			/beginGoalOrbit[\s\S]{0,280}goalFovBoost\s*=\s*Math\.max\(\s*this\.goalFovBoost,\s*6\s*\)/,
		);
		expect(src).toMatch(
			/endGoalOrbit[\s\S]{0,200}goalFovBoost\s*=\s*Math\.min\(\s*this\.goalFovBoost,\s*2\s*\)/,
		);
	});
});
