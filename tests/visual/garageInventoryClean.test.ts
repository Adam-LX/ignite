import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("garage inventory clean pass", () => {
	it("CSS ma czystszy inventory (mniejszy sidebar, ukryty hint, bez shimmer select)", () => {
		const css = readFileSync(
			resolve(__dirname, "../../src/menu-crate-garage.css"),
			"utf8",
		);
		expect(css).toContain("Garage inventory — clean pass");
		expect(css).toContain("Garage inventory — readable + flash");
		expect(css).toContain(".garage-hint {\n\tdisplay: none;");
		expect(css).toContain("width: 4.15rem");
		expect(css).toContain(".garage-hero__trait,\n.garage-hero__provenance");
		expect(css).toContain(".garage-hero__actions[hidden]");
	});

	it("hero nie pakuje trait/provenance do plate DOM", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/ui/LoadoutOverlay.ts"),
			"utf8",
		);
		expect(src).toContain("tylko title na nazwie");
		expect(src).not.toMatch(/traitEl\.className = "garage-hero__trait"/);
		expect(src).not.toMatch(/provEl\.className = "garage-hero__provenance"/);
		expect(src).toContain("garage-empty");
		expect(src).toContain("garage-search__icon");
		expect(src).toContain("garage-search--in-panel");
		expect(src).toContain('class="garage-tile__lock"');
		expect(src).toContain("garage-sidebar__btn--has-new");
		expect(src).toContain("garage-empty__clear");
		expect(src).toContain("garage-tile__kind");
		expect(src).toContain("data-garage-count");
		expect(src).toContain("resultCount");
		expect(src).toContain("focusSearch");
		expect(src).toContain("paintIrrelevant");
		expect(src).toContain("localeCompare");
		expect(src).toContain("garage-player-banner");
		expect(src).toContain("refreshPlayerBannerDock");
		expect(src).toContain("garage-player-banner-dock");
	});
});

describe("garage skosy + player banner CSS", () => {
	it("ma ostre clip-path na panelu i banner pod autem (nie pod inventory)", () => {
		const css = readFileSync(
			resolve(__dirname, "../../src/menu-live-ui.css"),
			"utf8",
		);
		expect(css).toContain("GARAGE SPECTACLE");
		expect(css).toContain("32px 0");
		expect(css).toContain("calc(100% - 32px) 0");
		expect(css).toContain(".garage-player-banner-dock");
		expect(css).toContain("min(42rem, 78vw)");
		expect(css).toContain("--pb-slash");
		expect(css).toContain("var(--pb-slash) 0");
	});
});

describe("garage showcase framing", () => {
	it("eksportuje offset auta w prawo (panel lewy)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/menuCinematicCamera.ts"),
			"utf8",
		);
		expect(src).toContain("export const GARAGE_HERO_X");
		expect(src).toContain("GARAGE_HERO_X");
		const live = readFileSync(
			resolve(__dirname, "../../src/ui/LiveMainMenuScene.ts"),
			"utf8",
		);
		expect(live).toContain("GARAGE_HERO_X");
		expect(live).toContain("garageLift");
		const cam = readFileSync(
			resolve(__dirname, "../../src/visual/menuCinematicCamera.ts"),
			"utf8",
		);
		expect(cam).toContain("baseYaw");
		expect(cam).toContain("0.55");
	});
});
