import * as THREE from "three";

/** Paleta neonu per mapa (arena-catalog atmosphere.neonAccent). */
export const ARENA_NEON_ACCENT_HEX: Record<string, number> = {
	cyan: 0x9adcff,
	orange: 0xffaa44,
	magenta: 0xff66cc,
	gold: 0xffcc66,
};

const DEFAULT_HEX = ARENA_NEON_ACCENT_HEX.cyan;

let activeAccentKey = "cyan";

export function resolveArenaNeonHex(accent?: string): number {
	return ARENA_NEON_ACCENT_HEX[accent ?? "cyan"] ?? DEFAULT_HEX;
}

export function resolveArenaNeonColor(accent?: string): THREE.Color {
	return new THREE.Color(resolveArenaNeonHex(accent));
}

export function setActiveArenaAccentKey(accent?: string): void {
	activeAccentKey = accent ?? "cyan";
}

export function getActiveArenaNeonHex(): number {
	return resolveArenaNeonHex(activeAccentKey);
}
