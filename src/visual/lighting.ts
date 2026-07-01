/** Filmowe proporcje — nocny stadion, mocny kontrast jupiterów z murawą. */
export const LIGHTING_FILM = {
	ambientColor: 0x2a3558,
	/** Światło otoczenia — tylko uniesienie czerni. */
	ambientIntensity: 0.2,
	directionalColor: 0xfff6ec,
	/** Główny kierunkowy z mapą cieni areny. */
	keyShadowIntensity: 1.6,
	/** Jupiter-y nad boiskiem. */
	jupiterIntensities: [1.38, 1.28, 1.42, 1.22] as const,
	hemisphereSky: 0x4a6aa8,
	hemisphereGround: 0x182818,
	hemisphereIntensity: 0.32,
	cornerSpotIntensities: [5.1, 4.9] as const,
} as const;

/** Próg audytu: ambient + najjaśniejszy directional (przed rebalance). */
export const LIGHTING_AUDIT_THRESHOLD = 2.5;

/** Limity po automatycznym rebalance. */
export const LIGHTING_SAFE_LIMITS = {
	ambientMax: 0.3,
	directionalMax: 1.5,
} as const;
