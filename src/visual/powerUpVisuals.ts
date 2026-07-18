import type { PowerUpHudState, PowerUpKind } from "../modes/IgnitionManager";

export const POWER_UP_RING_RADIUS = 40;
export const POWER_UP_RING_CIRCUMFERENCE = 2 * Math.PI * POWER_UP_RING_RADIUS;

export type PowerUpVisualKind = PowerUpKind | "charging";

export const POWER_UP_COLORS: Record<
	PowerUpVisualKind,
	{ primary: string; glow: string; three: number }
> = {
	magnet: {
		primary: "#c49bff",
		glow: "rgba(170, 110, 255, 0.82)",
		three: 0xb57cff,
	},
	plunger: {
		primary: "#7ee8ff",
		glow: "rgba(100, 220, 255, 0.72)",
		three: 0x7ee8ff,
	},
	haymaker: {
		primary: "#ffb07a",
		glow: "rgba(255, 150, 60, 0.72)",
		three: 0xffb07a,
	},
	spikes: {
		primary: "#ff8a9a",
		glow: "rgba(255, 90, 120, 0.72)",
		three: 0xff8a9a,
	},
	charging: {
		primary: "#8ec8ff",
		glow: "rgba(120, 190, 255, 0.45)",
		three: 0x8ec8ff,
	},
};

export function resolvePowerUpVisualKind(
	state: PowerUpHudState | null | undefined,
): PowerUpVisualKind | null {
	if (!state?.enabled) return null;
	if (state.activeKind && state.activeProgress > 0) return state.activeKind;
	if (state.held) return state.held;
	return "charging";
}

/** 0–1 — wypełnienie pierścienia (ładowanie lub pozostały czas aktywacji). */
export function powerUpRingFill(state: PowerUpHudState): number {
	if (state.activeKind && state.activeProgress > 0) {
		return Math.min(1, Math.max(0, state.activeProgress));
	}
	if (state.held) return 1;
	return Math.min(1, Math.max(0, state.pickProgress));
}

export function powerUpCenterTimer(state: PowerUpHudState): number | null {
	if (state.activeKind && state.activeSecondsLeft > 0) {
		return Math.ceil(state.activeSecondsLeft);
	}
	if (!state.held && state.pickSecondsLeft > 0) {
		return Math.ceil(state.pickSecondsLeft);
	}
	return null;
}

export function shouldShowPowerUpWorld(state: PowerUpHudState | null): boolean {
	if (!state?.enabled) return false;
	if (state.held === "spikes") return true;
	return state.activeKind !== null && state.activeProgress > 0;
}

export type PowerUpHintParts = {
	labelKey: `powerup.${PowerUpKind}` | "hud.powerUpCharging";
	suffixKey?: "hud.powerUpUse";
};

/** Klucze i18n dla podpisu pod pierścieniem HUD. */
export function resolvePowerUpHintParts(
	state: PowerUpHudState,
): PowerUpHintParts {
	if (state.activeKind && state.activeProgress > 0) {
		return { labelKey: `powerup.${state.activeKind}` };
	}
	if (state.held) {
		return { labelKey: `powerup.${state.held}`, suffixKey: "hud.powerUpUse" };
	}
	return { labelKey: "hud.powerUpCharging" };
}
