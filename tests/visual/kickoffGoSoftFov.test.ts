import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "../../src/Renderer.ts"), "utf8");

describe("kickoff GO soft FOV", () => {
	it("pulseKickoffIgnite FOV ≤4.8 (pro: czytelny kickoff)", () => {
		const i = src.indexOf("pulseKickoffIgnite()");
		expect(i).toBeGreaterThan(0);
		const slice = src.slice(i, i + 280);
		const m = slice.match(/goalFovBoost,\s*([\d.]+)/);
		expect(m).not.toBeNull();
		expect(Number(m![1])).toBeLessThanOrEqual(4.8);
		expect(Number(m![1])).toBeGreaterThanOrEqual(3.5);
	});

	it("countdown tick FOV peaki łagodniejsze", () => {
		const i = src.indexOf("pulseKickoffCountdownTick(");
		expect(i).toBeGreaterThan(0);
		const slice = src.slice(i, i + 360);
		expect(slice).toMatch(/1\.0\s*\+\s*tension\s*\*\s*1\.35/);
	});
});
