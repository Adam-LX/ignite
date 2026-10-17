import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LASER_PALETTE } from "../../src/visual/preMatchShow/StadiumLaserRig";

describe("StadiumLaserRig look", () => {
	it("paleta ma wiele jaskrawych kolorów (nie tylko blue/orange)", () => {
		expect(LASER_PALETTE.length).toBeGreaterThanOrEqual(8);
		const hues = new Set(
			LASER_PALETTE.map((c) => {
				const hsl = { h: 0, s: 0, l: 0 };
				c.getHSL(hsl);
				return Math.round(hsl.h * 12);
			}),
		);
		expect(hues.size).toBeGreaterThanOrEqual(5);
	});

	it("shader: cienkie wiązki, dash bez gaszenia rdzenia, bez white-wash", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/preMatchShow/StadiumLaserRig.ts"),
			"utf8",
		);
		expect(src).toContain("beamDash");
		expect(src).toContain("uDashScale");
		expect(src).toContain("uDashGap");
		expect(src).toMatch(/mix\(0\.55,\s*1/);
		expect(src).toContain("Dash = akcent");
		expect(src).toMatch(/width = 1\.[4-9]/);
		expect(src).toMatch(/gain = 6\.|gain = 7\./);
		expect(src).toMatch(/addProjector\([\s\S]*?,\s*9,/);
	});
});
