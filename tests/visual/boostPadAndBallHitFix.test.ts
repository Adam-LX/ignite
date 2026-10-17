import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("boost pad + ball hit fixes", () => {
	it("boost pad restores amber emissive when active (no stuck white plate)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/vfx/boostPadVfx.ts"),
			"utf8",
		);
		expect(src).toContain("padAmber");
		expect(src).toContain("plateMat.emissive.copy(this.padAmber)");
		expect(src).toContain("padAmberDim");
		expect(src).toContain("plateTint");
	});

	it("carBall hit uses punchy rate, not slowed thump-as-grass", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/audio/GameAudio.ts"),
			"utf8",
		);
		expect(src).toContain("0.98 + intensity * 0.18");
		expect(src).toContain('playSpatialImpact("carBall", soft');
		expect(src).not.toMatch(
			/kind === "carBall"[\s\S]{0,80}0\.92 - intensity \* 0\.22/,
		);
	});
});
