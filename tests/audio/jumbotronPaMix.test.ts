import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JUMBOTRON_PA_MIX } from "../../src/audio/GameAudio";
import {
	FILM_OFF_MS,
	FILM_ON_MS,
} from "../../src/visual/jumbotronFeed";

describe("jumbotron film slot timing", () => {
	it("film spot shorter than LED idle", () => {
		expect(FILM_ON_MS[0]).toBeGreaterThanOrEqual(8_000);
		expect(FILM_ON_MS[1]).toBeLessThanOrEqual(22_000);
		expect(FILM_OFF_MS[0]).toBeGreaterThanOrEqual(FILM_ON_MS[1]);
		expect(FILM_OFF_MS[1]).toBeLessThanOrEqual(90_000);
		expect(FILM_ON_MS[0]).toBeLessThan(FILM_ON_MS[1]);
		expect(FILM_OFF_MS[0]).toBeLessThan(FILM_OFF_MS[1]);
	});
});

describe("jumbotron PA mix contracts", () => {
	it("film open jest wyraźnie głośniejszy niż LED duck", () => {
		expect(JUMBOTRON_PA_MIX.masterHidden).toBeLessThan(0.12);
		expect(JUMBOTRON_PA_MIX.masterOpen).toBeGreaterThanOrEqual(1);
		expect(JUMBOTRON_PA_MIX.masterHidden).toBeLessThan(
			JUMBOTRON_PA_MIX.masterOpen * 0.12,
		);
	});

	it("dry PA jest czytelny (nie szept), wet daje pogłos stadionu", () => {
		expect(JUMBOTRON_PA_MIX.dry).toBeGreaterThanOrEqual(0.25);
		expect(JUMBOTRON_PA_MIX.dry).toBeLessThanOrEqual(0.45);
		expect(JUMBOTRON_PA_MIX.wet).toBeGreaterThan(0.28);
		expect(JUMBOTRON_PA_MIX.toneCutDb).toBeLessThan(0);
		expect(JUMBOTRON_PA_MIX.toneCutDb).toBeGreaterThan(-4);
	});

	it("stash film-open przed async PA connect (race fix)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/audio/GameAudio.ts"),
			"utf8",
		);
		expect(src).toContain("jumbotronFilmOpenDesired");
		expect(src).toMatch(
			/setJumbotronFilmOpen\(this\.jumbotronFilmOpenDesired\)/,
		);
	});
});
