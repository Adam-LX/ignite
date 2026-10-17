import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("match ping HUD tiers", () => {
	it("main: warn >120, bad >200", () => {
		const src = readFileSync(resolve(__dirname, "../../src/main.ts"), "utf8");
		const i = src.indexOf("function updateMatchPing");
		expect(i).toBeGreaterThan(0);
		const slice = src.slice(i, i + 900);
		expect(slice).toContain("ms > 200");
		expect(slice).toContain("ms > 120");
		expect(slice).toContain("match-ping--bad");
		expect(slice).toContain("mp.pingBad");
	});

	it("lobby: te same progi bad/warn", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/ui/MultiplayerLobby.ts"),
			"utf8",
		);
		const i = src.indexOf("private updatePingDisplay");
		expect(i).toBeGreaterThan(0);
		const slice = src.slice(i, i + 700);
		expect(slice).toContain("rttMs > 200");
		expect(slice).toContain("mp-ping--bad");
	});

	it("i18n pl+en mają mp.pingBad", () => {
		const pl = readFileSync(
			resolve(__dirname, "../../src/i18n/locales/pl.ts"),
			"utf8",
		);
		const en = readFileSync(
			resolve(__dirname, "../../src/i18n/locales/en.ts"),
			"utf8",
		);
		expect(pl).toContain('"mp.pingBad"');
		expect(en).toContain('"mp.pingBad"');
	});
});
