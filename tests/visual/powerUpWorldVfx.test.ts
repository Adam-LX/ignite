import { describe, expect, it } from "vitest";

import { shouldShowPowerUpWorld } from "../../src/visual/powerUpVisuals";
import type { PowerUpHudState } from "../../src/modes/IgnitionManager";

function hud(partial: Partial<PowerUpHudState>): PowerUpHudState {
	return {
		enabled: true,
		held: null,
		pickProgress: 0,
		pickSecondsLeft: 0,
		activeKind: null,
		activeProgress: 0,
		activeSecondsLeft: 0,
		...partial,
	};
}

describe("shouldShowPowerUpWorld", () => {
	it("held magnet bez aktywacji — tylko HUD / pickup 3D, bez wiązek", () => {
		const state = hud({ held: "magnet" });
		expect(shouldShowPowerUpWorld(state)).toBe(false);
	});

	it("aktywny magnet — wiązki w świecie", () => {
		const state = hud({
			held: null,
			activeKind: "magnet",
			activeProgress: 0.8,
		});
		expect(shouldShowPowerUpWorld(state)).toBe(true);
	});

	it("held spikes — kolce widoczne przed użyciem", () => {
		const state = hud({ held: "spikes" });
		expect(shouldShowPowerUpWorld(state)).toBe(true);
	});
});
