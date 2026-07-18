import { describe, expect, it } from "vitest";

import type { PowerUpHudState } from "../../src/modes/IgnitionManager";
import {
	POWER_UP_COLORS,
	resolvePowerUpHintParts,
	resolvePowerUpVisualKind,
} from "../../src/visual/powerUpVisuals";

function hud(partial: Partial<PowerUpHudState>): PowerUpHudState {
	return {
		enabled: true,
		held: null,
		pickProgress: 0,
		pickSecondsLeft: 10,
		activeKind: null,
		activeProgress: 0,
		activeSecondsLeft: 0,
		...partial,
	};
}

describe("resolvePowerUpHintParts", () => {
	it("held — nazwa power-upu + skrót R", () => {
		const parts = resolvePowerUpHintParts(hud({ held: "magnet", pickProgress: 1 }));
		expect(parts).toEqual({
			labelKey: "powerup.magnet",
			suffixKey: "hud.powerUpUse",
		});
	});

	it("active — tylko nazwa efektu", () => {
		const parts = resolvePowerUpHintParts(
			hud({
				activeKind: "plunger",
				activeProgress: 0.6,
				activeSecondsLeft: 2,
			}),
		);
		expect(parts).toEqual({ labelKey: "powerup.plunger" });
	});

	it("charging — ładowanie", () => {
		expect(resolvePowerUpHintParts(hud({ pickProgress: 0.3 }))).toEqual({
			labelKey: "hud.powerUpCharging",
		});
	});
});

describe("paintPowerUpHudIcon", () => {
	it("kolory z POWER_UP_COLORS są unikalne per typ", () => {
		const kinds = ["magnet", "plunger", "haymaker", "spikes"] as const;
		const primaries = kinds.map((k) => POWER_UP_COLORS[k].primary);
		expect(new Set(primaries).size).toBe(kinds.length);
	});

	it("resolvePowerUpVisualKind — held przed charging", () => {
		expect(resolvePowerUpVisualKind(hud({ held: "haymaker" }))).toBe("haymaker");
	});
});
