/**
 * Bazowe recepty optyki — match: niski bloom, flary + snopy niosą highlight.
 */

import type { OpticsRecipe, OpticsRecipeId } from "./opticsTypes";

const MATCH_LIGHTS_BASE = {
	/**
	 * Mniej fillu, więcej snopów — murawa ma plamy jupiterów / gobo,
	 * nie jednolity „światłomierz”.
	 */
	ambientMul: 0.62,
	hemiMul: 0.7,
	keyMul: 1.28,
	jupiterMul: 1.42,
	cornerMul: 1.45,
	goboMul: 1.75,
	/** Wąskie snopy ON — opacity niskie, skybox zostaje. */
	beamsVisible: true,
	beamOpacity: 0.1,
} as const;

function matchRecipe(
	id: OpticsRecipeId,
	shadows: OpticsRecipe["shadows"],
	bloomIntensity: number,
	flareBase: number,
	blur: OpticsRecipe["blur"],
): OpticsRecipe {
	return {
		id,
		mode: "match",
		lights: {
			...MATCH_LIGHTS_BASE,
			beamOpacity:
				id === "match.low" ? 0.04 : id === "match.deck" ? 0.055 : 0.075,
			beamsVisible: id !== "match.low",
		},
		shadows,
		bloom: {
			intensity: bloomIntensity,
			threshold: 0.96,
			smoothing: 0.18,
			kernel: "verySmall",
			radius: 0.22,
		},
		flares: {
			enabled: id !== "match.low",
			baseIntensity: flareBase,
			driveScale: 0.28,
			boostExtra: 0.14,
			sourceWeightMul: 1.05,
		},
		blur,
		grade: {
			exposure: 0.86,
			cool: 0.1,
			warm: 0.04,
			saturation: 1.48,
			vignette: 0.2,
		},
	};
}

export const OPTICS_RECIPES: Record<OpticsRecipeId, OpticsRecipe> = {
	"match.high": (() => {
		const base = matchRecipe(
			"match.high",
			{
				primaryMapSize: 2048,
				/** Jupiter SM = czarne plamy na murawie (klipy F9) — tylko key. */
				jupiterShadowCount: 0,
				/** Co 2. klatkę — wygląd ≈ co klatkę, mniej GPU. */
				autoUpdateEveryN: 2,
				/** Czytelny penumbra — za szeroki = cień znika w fillu. */
				primaryRadius: 5.4,
				jupiterRadius: 5.5,
				primaryIntensity: 0.94,
			},
			/** RTX high — bloom + flary: czytelność > wash. */
			0.07,
			0.95,
			{
				motionAtSpeedMps: 25,
				motionMax: 0.42,
				boostMotionExtra: 0.16,
				/** Słaby DoF — Free Cam midfield nie może mydlić cityscape. */
				dofBase: 0.08,
				premiumScale: 1,
			},
		);
		return {
			...base,
			lights: {
				...base.lights,
				/**
				 * Czytelny PT: bounce bez wash, snopy subtelne.
				 */
				ambientMul: 0.4,
				hemiMul: 0.8,
				keyMul: 1.48,
				jupiterMul: 1.42,
				cornerMul: 1.55,
				goboMul: 1.95,
				beamOpacity: 0.12,
			},
			shadows: {
				...base.shadows,
				primaryMapSize: 2048,
				/**
				 * Jupiter SM wyłączony — 2. mapa przy GRAJ = duży freeze,
				 * a potem sticky WASD (keyup ginie w hitchu).
				 */
				jupiterShadowCount: 0,
				autoUpdateEveryN: 4,
				primaryRadius: 5.4,
				jupiterRadius: 7.0,
				primaryIntensity: 1.05,
			},
			grade: {
				...base.grade,
				/** Kontrast: niższa ekspozycja, umiarkowana sat. */
				exposure: 0.8,
				cool: 0.1,
				warm: 0.06,
				saturation: 1.38,
				vignette: 0.42,
			},
			bloom: {
				...base.bloom,
				/** Selective bloom — tylko HDR highlighty, bez mydła. */
				intensity: 0.07,
				threshold: 0.94,
				smoothing: 0.16,
				kernel: "small",
				radius: 0.26,
			},
			flares: {
				...base.flares,
				baseIntensity: 0.95,
				driveScale: 0.42,
				boostExtra: 0.28,
				sourceWeightMul: 1.12,
			},
			blur: {
				...base.blur,
				dofBase: 0.28,
				motionMax: 0.42,
				boostMotionExtra: 0.16,
			},
		};
	})(),
	"match.medium": (() => {
		const base = matchRecipe(
			"match.medium",
			{
				primaryMapSize: 1024,
				jupiterShadowCount: 0,
				autoUpdateEveryN: 3,
				primaryRadius: 5.2,
				jupiterRadius: 5.5,
				primaryIntensity: 0.8,
			},
			0.045,
			0.75,
			{
				motionAtSpeedMps: 28,
				motionMax: 0.28,
				boostMotionExtra: 0.1,
				dofBase: 0.1,
				premiumScale: 0.75,
			},
		);
		return {
			...base,
			lights: {
				...base.lights,
				ambientMul: 0.45,
				hemiMul: 0.62,
				jupiterMul: 1.28,
				goboMul: 1.55,
				beamOpacity: 0.09,
			},
			bloom: {
				...base.bloom,
				intensity: 0.07,
				threshold: 0.92,
				smoothing: 0.18,
				kernel: "small",
				radius: 0.28,
			},
			flares: {
				...base.flares,
				baseIntensity: 1.0,
				sourceWeightMul: 1.18,
			},
		};
	})(),
	"match.low": matchRecipe(
		"match.low",
		{
			primaryMapSize: 512,
			jupiterShadowCount: 0,
			autoUpdateEveryN: 3,
			primaryRadius: 5.5,
			jupiterRadius: 5.5,
			primaryIntensity: 0.72,
		},
		0.045,
		0.55,
		{
			motionAtSpeedMps: 32,
			motionMax: 0.16,
			boostMotionExtra: 0.06,
			dofBase: 0,
			premiumScale: 0.45,
		},
	),
	"match.deck": matchRecipe(
		"match.deck",
		{
			primaryMapSize: 1024,
			jupiterShadowCount: 0,
			autoUpdateEveryN: 2,
			primaryRadius: 5.4,
			jupiterRadius: 5.5,
			primaryIntensity: 0.78,
		},
		0.04,
		0.68,
		{
			motionAtSpeedMps: 28,
			motionMax: 0.22,
			boostMotionExtra: 0.08,
			dofBase: 0.08,
			premiumScale: 0.55,
		},
	),
	menu: {
		id: "menu",
		mode: "menu",
		lights: {
			ambientMul: 1.2,
			hemiMul: 0.9,
			keyMul: 0.95,
			jupiterMul: 0.9,
			cornerMul: 0.82,
			goboMul: 0.7,
			beamsVisible: true,
			beamOpacity: 0.08,
		},
		shadows: {
			primaryMapSize: 1024,
			jupiterShadowCount: 0,
			autoUpdateEveryN: 0,
			primaryRadius: 1.25,
			jupiterRadius: 1.05,
		},
		bloom: {
			intensity: 0.14,
			threshold: 0.88,
			smoothing: 0.32,
			kernel: "small",
			radius: 0.32,
		},
		flares: {
			enabled: true,
			baseIntensity: 0.55,
			driveScale: 0,
			boostExtra: 0,
			sourceWeightMul: 1.05,
		},
		blur: {
			motionAtSpeedMps: 99,
			motionMax: 0,
			boostMotionExtra: 0,
			dofBase: 0.24,
			premiumScale: 0.85,
		},
		grade: {
			exposure: 0.88,
			cool: 0.08,
			warm: 0.06,
			saturation: 1.22,
			vignette: 0.22,
		},
	},
	garage: {
		id: "garage",
		mode: "garage",
		lights: {
			ambientMul: 1.35,
			hemiMul: 0.95,
			keyMul: 0.95,
			jupiterMul: 0.9,
			cornerMul: 0.85,
			goboMul: 0.45,
			beamsVisible: false,
			beamOpacity: 0,
		},
		shadows: {
			primaryMapSize: 1024,
			jupiterShadowCount: 0,
			autoUpdateEveryN: 0,
			primaryRadius: 1.2,
			jupiterRadius: 1,
		},
		bloom: {
			intensity: 0.1,
			threshold: 0.9,
			smoothing: 0.28,
			kernel: "small",
			radius: 0.28,
		},
		flares: {
			enabled: false,
			baseIntensity: 0,
			driveScale: 0,
			boostExtra: 0,
			sourceWeightMul: 0,
		},
		blur: {
			motionAtSpeedMps: 99,
			motionMax: 0,
			boostMotionExtra: 0,
			dofBase: 0.22,
			premiumScale: 0.7,
		},
		grade: {
			exposure: 0.9,
			cool: 0.05,
			warm: 0.08,
			saturation: 1.18,
			vignette: 0.16,
		},
	},
};

export function getOpticsRecipe(id: OpticsRecipeId): OpticsRecipe {
	return OPTICS_RECIPES[id];
}
