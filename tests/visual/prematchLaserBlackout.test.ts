import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("prematch laser blackout lighting", () => {
	it("ma flagę setPrematchLaserBlackout używaną w update paths", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/stadiumLighting.ts"),
			"utf8",
		);
		expect(src).toContain("export function setPrematchLaserBlackout");
		expect(src).toContain("laserBlackoutMul");
		expect(src).toContain("laserFillBlackoutMul");
		expect(src).toContain("prematchLaserBlackout");
	});
});
