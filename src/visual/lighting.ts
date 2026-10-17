/** Filmowe proporcje — wieczorny / nocny stadion (cinematic contrast, mniej jupiterów). */

export type LightingFilmId = "dusk" | "night";

export type LightingFilm = {
	ambientColor: number;
	/** Fill — wieczór / noc. */
	ambientIntensity: number;
	directionalColor: number;
	/** Główny kierunkowy z mapą cieni areny. */
	keyShadowIntensity: number;
	/** Jupiter-y — dramat bez prześwietlenia murawy. */
	jupiterIntensities: readonly [number, number, number, number];
	hemisphereSky: number;
	hemisphereGround: number;
	hemisphereIntensity: number;
	cornerSpotIntensities: readonly [number, number];
};

/** Zachód / early evening — mniej fillu, mocniejszy key + narożniki (gobo czyta się lepiej). */
export const LIGHTING_FILM_DUSK: LightingFilm = {
	ambientColor: 0x1c2a40,
	ambientIntensity: 0.12,
	directionalColor: 0xffeed8,
	keyShadowIntensity: 1.65,
	jupiterIntensities: [0.55, 0.48, 0.58, 0.46],
	hemisphereSky: 0x384868,
	hemisphereGround: 0x102418,
	hemisphereIntensity: 0.34,
	cornerSpotIntensities: [2.05, 1.88],
};

/** Głęboka noc — snopy czytelne, fill nie spłaszcza murawy. */
export const LIGHTING_FILM_NIGHT: LightingFilm = {
	ambientColor: 0x0a121c,
	ambientIntensity: 0.042,
	directionalColor: 0xd8eaff,
	keyShadowIntensity: 2.15,
	jupiterIntensities: [0.62, 0.56, 0.62, 0.54],
	hemisphereSky: 0x22204a,
	/** Zielonkawy bounce z murawy — fake GI jak path tracing. */
	hemisphereGround: 0x0e3420,
	hemisphereIntensity: 0.22,
	cornerSpotIntensities: [2.55, 2.35],
};

/**
 * Domyślny eksport = night (standard Ignite).
 * Aktywny profil areny: `getActiveLightingFilm()` / `setActiveLightingFilm`.
 */
export const LIGHTING_FILM: LightingFilm = LIGHTING_FILM_NIGHT;

let activeLightingFilmId: LightingFilmId = "night";

export function resolveLightingFilm(id?: string | null): LightingFilm {
	return id === "dusk" ? LIGHTING_FILM_DUSK : LIGHTING_FILM_NIGHT;
}

export function setActiveLightingFilm(id?: string | null): LightingFilmId {
	activeLightingFilmId = id === "dusk" ? "dusk" : "night";
	return activeLightingFilmId;
}

export function getActiveLightingFilmId(): LightingFilmId {
	return activeLightingFilmId;
}

export function getActiveLightingFilm(): LightingFilm {
	return resolveLightingFilm(activeLightingFilmId);
}

/** Smooth blend dusk→night (0 = dusk, 1 = night). */
export function sampleLightingFilm(mixNight: number): LightingFilm {
	const t = Math.min(1, Math.max(0, mixNight));
	const a = LIGHTING_FILM_DUSK;
	const b = LIGHTING_FILM_NIGHT;
	const lerp = (x: number, y: number) => x + (y - x) * t;
	const lerpHex = (x: number, y: number) => {
		const xr = (x >> 16) & 0xff;
		const xg = (x >> 8) & 0xff;
		const xb = x & 0xff;
		const yr = (y >> 16) & 0xff;
		const yg = (y >> 8) & 0xff;
		const yb = y & 0xff;
		const r = Math.round(lerp(xr, yr));
		const g = Math.round(lerp(xg, yg));
		const bl = Math.round(lerp(xb, yb));
		return (r << 16) | (g << 8) | bl;
	};
	return {
		ambientColor: lerpHex(a.ambientColor, b.ambientColor),
		ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity),
		directionalColor: lerpHex(a.directionalColor, b.directionalColor),
		keyShadowIntensity: lerp(a.keyShadowIntensity, b.keyShadowIntensity),
		jupiterIntensities: [
			lerp(a.jupiterIntensities[0], b.jupiterIntensities[0]),
			lerp(a.jupiterIntensities[1], b.jupiterIntensities[1]),
			lerp(a.jupiterIntensities[2], b.jupiterIntensities[2]),
			lerp(a.jupiterIntensities[3], b.jupiterIntensities[3]),
		],
		hemisphereSky: lerpHex(a.hemisphereSky, b.hemisphereSky),
		hemisphereGround: lerpHex(a.hemisphereGround, b.hemisphereGround),
		hemisphereIntensity: lerp(a.hemisphereIntensity, b.hemisphereIntensity),
		cornerSpotIntensities: [
			lerp(a.cornerSpotIntensities[0], b.cornerSpotIntensities[0]),
			lerp(a.cornerSpotIntensities[1], b.cornerSpotIntensities[1]),
		],
	};
}

/** Próg audytu: ambient + najjaśniejszy directional (przed rebalance). */
export const LIGHTING_AUDIT_THRESHOLD = 2.4;

/** Limity po automatycznym rebalance. */
export const LIGHTING_SAFE_LIMITS = {
	ambientMax: 0.28,
	/** Night key ~2.65 — nie clampuj kontrastu stadionu. */
	directionalMax: 2.85,
} as const;
