import type { ScoringTeam } from "./modes";

/** Sojusznicy (niebieska drużyna, slot > 0). */
export const BLUE_BOT_NAMES = ["Nyra", "Kael", "Voss", "Plex"] as const;

/** Przeciwnicy (pomarańczowa drużyna). */
export const ORANGE_BOT_NAMES = ["Rook", "Zara", "Drex", "Mako"] as const;

/** FFA Ignition — 8 slotów (slot 0 = gracz). */
export const IGNITION_FFA_NAMES = [
	"Spark",
	"Flash",
	"Blaze",
	"Ember",
	"Surge",
	"Volt",
	"Nova",
	"Flare",
] as const;

/** Pojedynek 1v1 / Ignition test — bot rywal. */
export const DUEL_RIVAL_NAMES = ["Rook", "Hex", "Volt", "Ember"] as const;

function pickName(
	names: readonly string[],
	slot: number,
	fallback: string,
): string {
	return names[slot] ?? fallback;
}

export function botDisplayName(
	team: ScoringTeam,
	teamSlot: number,
	isHuman: boolean,
): string {
	if (isHuman) return "You";
	if (team === "blue") {
		return pickName(BLUE_BOT_NAMES, teamSlot, `Ally ${teamSlot + 1}`);
	}
	return pickName(ORANGE_BOT_NAMES, teamSlot, `Rival ${teamSlot + 1}`);
}

export function ignitionFfaDisplayName(slotIndex: number): string {
	if (slotIndex === 0) return "You";
	return IGNITION_FFA_NAMES[slotIndex] ?? `Rival ${slotIndex + 1}`;
}

export function duelRivalDisplayName(): string {
	return DUEL_RIVAL_NAMES[0] ?? "Rook";
}
