import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "../../src/Renderer.ts"), "utf8");

describe("kickoff FOV juice (pro soft)", () => {
	it("IGNITE GO FOV punch ≤4.8; countdown tick bez hard boom", () => {
		expect(src).toMatch(
			/pulseKickoffIgnite\(\)[\s\S]{0,200}goalFovBoost\s*=\s*Math\.max\(\s*this\.goalFovBoost,\s*4\.6\s*\)/,
		);
		expect(src).toMatch(
			/pulseKickoffCountdownTick[\s\S]{0,280}1\.0\s*\+\s*tension\s*\*\s*1\.35/,
		);
		const juice = src.indexOf("finishKickoffCamJuice(dt");
		expect(juice).toBeGreaterThan(0);
		const slice = src.slice(juice, juice + 700);
		expect(slice).toMatch(/shakeIntensity\s*=\s*0/);
	});
});
