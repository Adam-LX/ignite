/**
 * Bazowe recepty optyki — match: niski bloom, flary + snopy niosą highlight.
 */

import type { OpticsRecipe, OpticsRecipeId } from "./opticsTypes";

const MATCH_LIGHTS_BASE = {
	/**
	 * Mniej fillu, więcej snopów — murawa ma plamy jupiterów / gobo,
	 * nie jednolity „światłomierz”.
	 */
	ambientMul: 0.78,
	hemiMul: 0.82,
	keyMul: 1.12,
	jupiterMul: 1.35,
	cornerMul: 1.4,
	goboMul: 1.65,
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
				/** Szeroki penumbra — twarde SM = trójkąty / half-pitch. */
				primaryRadius: 8.5,
				jupiterRadius: 6.5,
			},
			/** RTX high — bloom + flary mają „otworzyć ryj”, nie mydło. */
			0.1,
			1.35,
			{
				motionAtSpeedMps: 25,
				motionMax: 0.42,
				boostMotionExtra: 0.16,
				dofBase: 0.2,
				premiumScale: 1,
			},
		);
		return {
			...base,
			lights: {
				...base.lights,
				ambientMul: 0.72,
				hemiMul: 0.8,
				keyMul: 1.22,
				jupiterMul: 1.55,
				cornerMul: 1.6,
				goboMul: 1.95,
				beamOpacity: 0.16,
			},
			bloom: {
				...base.bloom,
				intensity: 0.1,
				threshold: 0.9,
				radius: 0.32,
			},
			flares: {
				...base.flares,
				baseIntensity: 1.35,
				driveScale: 0.38,
				boostExtra: 0.22,
				sourceWeightMul: 1.2,
			},
			grade: {
				...base.grade,
				exposure: 0.88,
				cool: 0.14,
				warm: 0.06,
				saturation: 1.62,
				vignette: 0.32,
			},
		};
	})(),
	"match.medium": matchRecipe(
		"match.medium",
		{
			primaryMapSize: 1024,
			jupiterShadowCount: 0,
			autoUpdateEveryN: 2,
			primaryRadius: 7.5,
			jupiterRadius: 6,
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
	),
	"match.low": matchRecipe(
		"match.low",
		{
			primaryMapSize: 512,
			jupiterShadowCount: 0,
			autoUpdateEveryN: 3,
			primaryRadius: 6.5,
			jupiterRadius: 5.5,
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
			primaryRadius: 7.2,
			jupiterRadius: 5.8,
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
			ambientMul: 1.55,
			hemiMul: 1.08,
			keyMul: 0.95,
			jupiterMul: 0.95,
			cornerMul: 0.88,
			goboMul: 0.88,
			beamsVisible: true,
			beamOpacity: 0.06,
		},
		shadows: {
			primaryMapSize: 1024,
			jupiterShadowCount: 0,
			autoUpdateEveryN: 0,
			primaryRadius: 1.25,
			jupiterRadius: 1.05,
		},
		bloom: {
			intensity: 0.22,
			threshold: 0.78,
			smoothing: 0.4,
			kernel: "small",
			radius: 0.34,
		},
		flares: {
			enabled: true,
			baseIntensity: 0.72,
			driveScale: 0,
			boostExtra: 0,
			sourceWeightMul: 1.1,
		},
		blur: {
			motionAtSpeedMps: 99,
			motionMax: 0,
			boostMotionExtra: 0,
			dofBase: 0.24,
			premiumScale: 0.85,
		},
		grade: {
			exposure: 0.95,
			cool: 0.08,
			warm: 0.06,
			saturation: 1.28,
			vignette: 0.18,
		},
	},
	garage: {
		id: "garage",
		mode: "garage",
		lights: {
			ambientMul: 1.85,
			hemiMul: 1.25,
			keyMul: 0.9,
			jupiterMul: 1.05,
			cornerMul: 0.92,
			goboMul: 0.5,
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
			intensity: 0.14,
			threshold: 0.88,
			smoothing: 0.36,
			kernel: "small",
			radius: 0.3,
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
			exposure: 1.0,
			cool: 0.05,
			warm: 0.08,
			saturation: 1.22,
			vignette: 0.12,
		},
	},
};

export function getOpticsRecipe(id: OpticsRecipeId): OpticsRecipe {
	return OPTICS_RECIPES[id];
}
