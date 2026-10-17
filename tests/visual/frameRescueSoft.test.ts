import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("frame rescue soft thresholds", () => {
	it("rzadszy snap — absX >0.94 i cooldown ≥0.8s", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/Renderer.ts"),
			"utf8",
		);
		const i = src.indexOf("const absX = Math.abs(ndc.x)");
		expect(i).toBeGreaterThan(0);
		const slice = src.slice(i, i + 500);
		expect(slice).toMatch(/absX\s*>\s*0\.94/);
		expect(slice).toMatch(/frameRescueCooldown\s*=\s*0\.85/);
	});
});
