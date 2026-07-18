import { describe, expect, it } from "vitest";

import {
	getMatchDurationSec,
	getModePolicy,
	menuModeOrder,
	menuModeOrderForDeck,
	menuModeSections,
	modeMenuDeckForMode,
} from "../../src/game/modePolicy";
import { modeHasPowerUps } from "../../src/game/modes";

describe("modePolicy", () => {
	it("core modes stay RL-pure", () => {
		for (const mode of ["1v1", "2v2", "3v3", "4v4"] as const) {
			const policy = getModePolicy(mode);
			expect(policy.family).toBe("coreSoccar");
			expect(policy.features.ignitionRush).toBe(false);
			expect(policy.features.teamOvercharge).toBe(false);
			expect(policy.features.bodyTraits).toBe(false);
			expect(modeHasPowerUps(mode)).toBe(false);
		}
	});

	it("ignitionRush2v2 enables field-energy features", () => {
		const policy = getModePolicy("ignitionRush2v2");
		expect(policy.family).toBe("experimental");
		expect(policy.features.ignitionRush).toBe(true);
		expect(policy.features.teamOvercharge).toBe(true);
		expect(policy.features.ignitionZones).toBe(true);
		expect(policy.features.bodyTraits).toBe(true);
		expect(policy.features.powerUps).toBe(false);
		expect(getMatchDurationSec("ignitionRush2v2")).toBe(420);
	});

	it("weekly lab adds mutator flag", () => {
		expect(getModePolicy("weeklyLab2v2").features.weeklyMutator).toBe(true);
	});

	it("ignition FFA keeps power-ups only", () => {
		expect(modeHasPowerUps("ignition")).toBe(true);
		expect(getModePolicy("ignition").features.ignitionRush).toBe(false);
	});

	it("menu sections flatten to carousel order", () => {
		const flat = menuModeSections().flatMap((section) => section.modes);
		expect(menuModeOrder()).toEqual(flat);
		expect(flat[0]).toBe("1v1");
		expect(flat).toContain("ignitionRush2v2");
		expect(flat).toContain("weeklyLab2v2");
	});

	it("menu decks split core vs experimental+lab", () => {
		expect(menuModeOrderForDeck("core")).toEqual(["1v1", "2v2", "3v3", "4v4"]);
		expect(menuModeOrderForDeck("experimental")).toEqual([
			"ignitionRush2v2",
			"meridian2v2",
			"ignition1v1",
			"ignition",
			"weeklyLab2v2",
		]);
		expect(modeMenuDeckForMode("2v2")).toBe("core");
		expect(modeMenuDeckForMode("ignition")).toBe("experimental");
		expect(modeMenuDeckForMode("weeklyLab2v2")).toBe("experimental");
		expect(modeMenuDeckForMode("meridian2v2")).toBe("experimental");
	});

	it("meridian2v2 is possession-only experimental", () => {
		const policy = getModePolicy("meridian2v2");
		expect(policy.family).toBe("experimental");
		expect(policy.features.meridian).toBe(true);
		expect(policy.features.ignitionRush).toBe(false);
		expect(policy.features.powerUps).toBe(false);
		expect(getMatchDurationSec("meridian2v2")).toBe(300);
	});
});
