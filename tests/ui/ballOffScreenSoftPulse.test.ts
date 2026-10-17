import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ball off-screen indicator soft pulse", () => {
	it("wolniejszy, mniejszy pulse (czytelność Free Cam)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/ui/BallOffScreenIndicator.ts"),
			"utf8",
		);
		expect(src).toMatch(/Math\.sin\(this\.pulsePhase\s*\*\s*5\.2\)/);
		expect(src).toMatch(/0\.9\s*\+\s*Math\.sin[\s\S]{0,40}\*\s*0\.1/);
	});

	it("CSS fade ≥0.12s", () => {
		const css = readFileSync(
			resolve(__dirname, "../../src/style.css"),
			"utf8",
		);
		const i = css.indexOf("#ball-offscreen {");
		expect(i).toBeGreaterThan(0);
		const slice = css.slice(i, i + 320);
		expect(slice).toMatch(/opacity\s+0\.1[2-9]s/);
	});
});
