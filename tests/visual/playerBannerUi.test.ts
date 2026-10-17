import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("player banner placement (RL-style UI)", () => {
	it("nie montuje 3D plane za autem w LiveMainMenuScene", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/ui/LiveMainMenuScene.ts"),
			"utf8",
		);
		expect(src).not.toContain("MenuPlayerBanner");
		expect(src).not.toContain("menuPlayerBanner");
		expect(src).not.toContain("setPlayerBanner");
	});

	it("menu / garaż / gol używają UI nameplate", () => {
		const menu = readFileSync(
			resolve(__dirname, "../../src/ui/MainMenu.ts"),
			"utf8",
		);
		const loadout = readFileSync(
			resolve(__dirname, "../../src/ui/LoadoutOverlay.ts"),
			"utf8",
		);
		const hud = readFileSync(
			resolve(__dirname, "../../src/ui/RlHud.ts"),
			"utf8",
		);
		expect(menu).toContain("rl-player-banner");
		expect(menu).toContain("rl-player-banner-dock");
		expect(menu).toContain("refreshPlayerBanner");
		expect(loadout).toContain("applyPlayerBannerStyle");
		expect(hud).toContain("applyPlayerBannerStyle");
	});

	it("menu banner: dół + skosy clip-path", () => {
		const css = readFileSync(
			resolve(__dirname, "../../src/menu-live-ui.css"),
			"utf8",
		);
		expect(css).toContain(".rl-player-banner-dock");
		expect(css).toContain("bottom: clamp(5.5rem");
		expect(css).toContain("--pb-slash");
		expect(css).toContain("var(--pb-slash) 0");
		expect(css).toContain("calc(100% - var(--pb-slash)) 100%");
		expect(css).toContain("repeating-linear-gradient");
		expect(css).toContain("scorebug");
	});
});
