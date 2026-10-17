import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const menuSrc = readFileSync(
	resolve(__dirname, "../../src/ui/MainMenu.ts"),
	"utf8",
);

describe("MainMenu mode-card keyboard focus", () => {
	it("focuses active mode card (not always PLAY)", () => {
		expect(menuSrc).toContain("focusActiveModeCard");
		expect(menuSrc).toMatch(
			/focusActiveModeCard\(\)[\s\S]{0,200}\.mode-card\.active/,
		);
		expect(menuSrc).toMatch(/ArrowLeft|ArrowRight/);
	});

	it("fokusuje aktywną kartę po intro (nie tylko Arrow)", () => {
		expect(menuSrc).toContain("playCardsIntro");
		const introIdx = menuSrc.indexOf("private playCardsIntro");
		const focusInIntro = menuSrc.indexOf(
			"this.focusActiveModeCard()",
			introIdx,
		);
		expect(introIdx).toBeGreaterThan(0);
		expect(focusInIntro).toBeGreaterThan(introIdx);
		expect(focusInIntro - introIdx).toBeLessThan(900);
	});
});
