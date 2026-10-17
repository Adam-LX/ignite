import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
	resolve(__dirname, "../../src/ai/BotBehavior.ts"),
	"utf8",
);

describe("BotBehavior orbit punch (dead-hit breakout)", () => {
	it("1v1 punchuje wcześniej niż 2v2 (~0.12s vs ~0.16s)", () => {
		expect(src).toContain("orbitStuckSec");
		expect(src).toContain("orbitPunchBoost");
		expect(src).toMatch(/teamSize\s*===\s*1\s*\?\s*0\.12\s*:\s*0\.16/);
		expect(src).toMatch(/ALIGN_SHOT[\s\S]{0,400}orbitStuckSec\s*\+=\s*dt/);
	});
});
