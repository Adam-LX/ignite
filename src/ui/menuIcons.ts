import type { GameModeId } from "../game/modes";

/** Inline SVG ikony — stroke-based, skalowane przez CSS. */
export const MENU_ICONS = {
	duel: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M8 32 L18 20 L28 26 L40 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="34" r="5" stroke="currentColor" stroke-width="2"/><circle cx="36" cy="10" r="5" stroke="currentColor" stroke-width="2"/><path d="M22 18 L26 30" stroke="currentColor" stroke-width="2" opacity=".5"/></svg>`,
	team2: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="6" y="14" width="14" height="20" rx="3" stroke="currentColor" stroke-width="2"/><rect x="28" y="14" width="14" height="20" rx="3" stroke="currentColor" stroke-width="2"/><circle cx="13" cy="38" r="4" stroke="currentColor" stroke-width="2"/><circle cx="35" cy="38" r="4" stroke="currentColor" stroke-width="2"/><path d="M24 8 L24 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
	team3: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 6 L38 14 L38 30 L24 38 L10 30 L10 14 Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="24" cy="22" r="6" stroke="currentColor" stroke-width="2"/><path d="M24 28 L24 34" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
	chaos: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" stroke-width="2"/><rect x="29" y="5" width="14" height="14" rx="2" stroke="currentColor" stroke-width="2"/><rect x="5" y="29" width="14" height="14" rx="2" stroke="currentColor" stroke-width="2"/><rect x="29" y="29" width="14" height="14" rx="2" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="24" r="5" fill="currentColor" opacity=".35"/></svg>`,
	ignition: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 6 C24 6 14 22 14 30 C14 36 18 42 24 42 C30 42 34 36 34 30 C34 22 24 6 24 6Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M24 20 C24 20 20 28 20 31 C20 34 22 36 24 36 C26 36 28 34 28 31 C28 28 24 20 24 20Z" fill="currentColor" opacity=".45"/></svg>`,
	play: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M14 10 L38 24 L14 38 Z" fill="currentColor"/><path d="M8 40 L8 8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".4"/></svg>`,
	online: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="2"/><ellipse cx="24" cy="24" rx="8" ry="16" stroke="currentColor" stroke-width="2"/><path d="M8 24 L40 24" stroke="currentColor" stroke-width="2" opacity=".5"/><circle cx="36" cy="12" r="5" fill="currentColor"/></svg>`,
	credits: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="2"/><path d="M24 16 L24 20 M24 28 L24 32" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M18 22 C18 19 21 18 24 18 C27 18 30 19 30 22 C30 25 24 24 24 28 C24 32 30 31 30 34" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
	boost: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 4 L30 18 L44 20 L34 30 L37 44 L24 37 L11 44 L14 30 L4 20 L18 18 Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
	lab: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M18 8 L30 8 L36 40 L12 40 Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M20 18 L28 18 M22 26 L26 26 M23 34 L25 34" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="34" cy="14" r="4" stroke="currentColor" stroke-width="2"/></svg>`,
	meridian: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="2"/><path d="M24 8 L24 40" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 24 L38 24" stroke="currentColor" stroke-width="2" opacity=".45"/><path d="M14 14 A16 16 0 0 1 34 14" stroke="currentColor" stroke-width="2" opacity=".55"/><path d="M14 34 A16 16 0 0 0 34 34" stroke="currentColor" stroke-width="2" opacity=".55"/></svg>`,
} as const;

const MODE_ICON: Record<GameModeId, keyof typeof MENU_ICONS> = {
	"1v1": "duel",
	"2v2": "team2",
	"3v3": "team3",
	"4v4": "chaos",
	ignitionRush2v2: "ignition",
	meridian2v2: "meridian",
	ignition1v1: "ignition",
	ignition: "ignition",
	weeklyLab2v2: "lab",
};

export function modeIcon(id: GameModeId): string {
	return MENU_ICONS[MODE_ICON[id]];
}
