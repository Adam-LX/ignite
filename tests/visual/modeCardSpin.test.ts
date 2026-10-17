import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("mode card spin vs compositor", () => {
	it("compositor nie zabija spinu na aktywnej karcie", () => {
		const compositor = readFileSync(
			resolve(__dirname, "../../src/menu-showcase-compositor.css"),
			"utf8",
		);
		expect(compositor).toContain(
			".mode-card--wypas.active:not(.mode-card--spin)",
		);
		expect(compositor).not.toMatch(
			/\.mode-card--wypas\.active,\s*\nbody\.menu-active #main-menu \.mode-card--wypas\.active \.mode-card__shimmer/,
		);
	});

	it("nawigacja playlist wymusza spin", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/ui/MainMenu.ts"),
			"utf8",
		);
		expect(src).toContain('this.selectMode(next, false, "always"');
		expect(src).toContain("playCardSpin");
		expect(src).toContain('spinPolicy === "always"');
	});

	it("CSS nie blokuje transform spinu na .active", () => {
		const css = readFileSync(
			resolve(__dirname, "../../src/menu-live-ui.css"),
			"utf8",
		);
		expect(css).toContain("active:not(.mode-card--spin)");
		expect(css).toContain("@keyframes menu-plate-spin");
		expect(css).toContain("rotateY(360deg)");
		expect(css).toContain("perspective(1100px)");
		expect(css).toContain("preserve-3d");
		expect(css).toContain("0.68s");
		expect(css).toContain("rotateY(90deg)");
		expect(css).toContain("rotateY(180deg)");
		expect(css).not.toContain("rotateZ(360deg)");
		expect(css).toContain(
			".mode-card:not(.mode-card--spin):not(.mode-card--pick)",
		);
		expect(css).not.toMatch(
			/\.mode-card\.mode-card--spin[^{]*\{[^}]*transform:\s*none\s*!important/s,
		);
	});
});
