import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");

function css(name: string): string {
	return readFileSync(join(ROOT, "src", name), "utf8");
}

describe("menu mode-card CSS contracts", () => {
	it("live-ui: white/gradient outline only on active card", () => {
		const live = css("menu-live-ui.css");
		expect(live).toMatch(/\.mode-card\.active::after/);
		expect(live).toMatch(/\.mode-card\.selected::after/);
		expect(live).toMatch(/conic-gradient/);
		expect(live).toMatch(/mode-card-ring-spin/);
		expect(live).toMatch(/0 0 16px rgba\(255,\s*255,\s*255/);
		/** Hover alone must not paint ring on ::after */
		const hoverAfter = live.match(
			/\.mode-card:hover::after\s*\{[^}]*\}/,
		)?.[0];
		if (hoverAfter) {
			expect(hoverAfter).not.toMatch(/conic-gradient/);
			expect(hoverAfter).not.toMatch(/border-color:\s*#ffffff/);
		}
	});

	it("live-ui: jednolity border-radius na wszystkich kartach", () => {
		const live = css("menu-live-ui.css");
		expect(live).toMatch(/--mode-card-radius:\s*14px/);
		expect(live).toMatch(
			/border-radius:\s*var\(--mode-card-radius\)\s*!important/,
		);
		/** Baza nie może wymuszać ostrych rogów na mode-card */
		expect(live).not.toMatch(
			/\.mode-card[^{]*\{[^}]*border-radius:\s*0\s*!important/s,
		);
	});

	it("live-ui: uniform -14deg skew including last-child", () => {
		const live = css("menu-live-ui.css");
		expect(live).toMatch(/skewX\(-14deg\)/);
		expect(live).toMatch(/mode-card:last-child/);
		expect(live).toMatch(/--card-skew-deg:\s*-14deg/);
		expect(live).toMatch(/--play-skew-deg:\s*-14deg/);
	});

	it("apex no longer kills active ::after with display:none", () => {
		const apex = css("menu-apex.css");
		expect(apex).not.toMatch(
			/\.mode-card--wypas\.active::after\s*\{\s*display:\s*none/,
		);
		expect(apex).not.toMatch(/contain:\s*paint/);
	});

	it("live-ui: content counter-skews so text stays readable", () => {
		const live = css("menu-live-ui.css");
		expect(live).toMatch(/skewX\(calc\(var\(--card-skew-deg\) \* -1\)\)/);
	});

	it("live-ui: ::after ring base is opacity 0 (no first-child always-on)", () => {
		const live = css("menu-live-ui.css");
		expect(live).not.toMatch(/\.mode-card:first-child::after/);
		expect(live).toMatch(/\.mode-card::after/);
		expect(live).toMatch(/border:\s*3\.5px solid transparent/);
		expect(live).toMatch(/opacity:\s*0;/);
	});

	it("live-ui: hover sam nie włącza ringa na ::after", () => {
		const live = css("menu-live-ui.css");
		expect(live).not.toMatch(
			/\.mode-card:hover(?!:not|\.active|\.selected)::after\s*\{[^}]*#ffffff/,
		);
		expect(live).not.toMatch(
			/\.mode-card:hover::after\s*\{[^}]*border-color:\s*#fff/,
		);
		/** Ring (conic / animation) tylko przy .active / .selected */
		const ringBlocks = [
			...live.matchAll(
				/\.mode-card[^{]*::after\s*\{[^}]*(?:conic-gradient|mode-card-ring-spin)[^}]*\}/gs,
			),
		].map((m) => m[0]);
		expect(ringBlocks.length).toBeGreaterThan(0);
		for (const block of ringBlocks) {
			expect(block).toMatch(/\.active|\.selected/);
		}
	});
});
