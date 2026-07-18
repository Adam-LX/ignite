/** Filmowe proporcje — wieczorny stadion (ciemniej, nadal czytelnie). */
export const LIGHTING_FILM = {
	ambientColor: 0x243048,
	/** Fill — wieczór. */
	ambientIntensity: 0.2,
	directionalColor: 0xffebd4,
	/** Główny kierunkowy z mapą cieni areny. */
	keyShadowIntensity: 1.1,
	/** Jupiter-y — dramat bez prześwietlenia murawy. */
	jupiterIntensities: [0.95, 0.88, 0.98, 0.84] as const,
	hemisphereSky: 0x304870,
	hemisphereGround: 0x141c18,
	hemisphereIntensity: 0.3,
	cornerSpotIntensities: [3.1, 3.0] as const,
} as const;

/** Próg audytu: ambient + najjaśniejszy directional (przed rebalance). */
export const LIGHTING_AUDIT_THRESHOLD = 2.8;

/** Limity po automatycznym rebalance. */
export const LIGHTING_SAFE_LIMITS = {
	ambientMax: 0.42,
	directionalMax: 1.75,
} as const;
