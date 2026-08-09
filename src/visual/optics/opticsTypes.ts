/**
 * Zunifikowane recepty optyki — światła / cienie / bloom / flary / snopy / blur.
 * Jedna liczba w recipe zamiast rozsianych magic w Renderer/GameSession.
 */

import type { GraphicsQuality } from "../../util/graphicsProfile";

export type OpticsMode = "match" | "menu" | "garage";

export type OpticsRecipeId =
	| "match.high"
	| "match.medium"
	| "match.low"
	| "match.deck"
	| "menu"
	| "garage";

export type OpticsLightsRecipe = {
	ambientMul: number;
	hemiMul: number;
	keyMul: number;
	jupiterMul: number;
	cornerMul: number;
	goboMul: number;
	/** Mesh godrays (jupiter cones). */
	beamsVisible: boolean;
	beamOpacity: number;
};

export type OpticsShadowsRecipe = {
	primaryMapSize: number;
	jupiterShadowCount: number;
	/** high: co klatkę; med/low: co N. */
	autoUpdateEveryN: number;
	primaryRadius: number;
	jupiterRadius: number;
};

export type OpticsBloomRecipe = {
	intensity: number;
	threshold: number;
	smoothing: number;
	/** 0=VERY_SMALL … mapowane w directorze. */
	kernel: "verySmall" | "small" | "medium";
	radius: number;
};

export type OpticsFlaresRecipe = {
	enabled: boolean;
	baseIntensity: number;
	driveScale: number;
	boostExtra: number;
	sourceWeightMul: number;
};

export type OpticsBlurRecipe = {
	/** Mecz: motion przy prędkości; menu: DoF. */
	motionAtSpeedMps: number;
	motionMax: number;
	boostMotionExtra: number;
	dofBase: number;
	premiumScale: number;
};

export type OpticsGradeRecipe = {
	exposure: number;
	cool: number;
	warm: number;
	saturation: number;
	vignette: number;
};

export type OpticsRecipe = {
	id: OpticsRecipeId;
	mode: OpticsMode;
	lights: OpticsLightsRecipe;
	shadows: OpticsShadowsRecipe;
	bloom: OpticsBloomRecipe;
	flares: OpticsFlaresRecipe;
	blur: OpticsBlurRecipe;
	grade: OpticsGradeRecipe;
};

export type OpticsDriveLayer = {
	speedMps: number;
	boosting: boolean;
};

export type OpticsSpectacleLayer = {
	/** 0–1+ goal/demo/etc. */
	amount: number;
};

export type OpticsAtmosphereLayer = {
	exposureOffset: number;
	coolGrade: number;
	warmGrade: number;
	bloomBias: number;
};

export type OpticsFloodLayer = {
	active: boolean;
	mix: number;
};

export function recipeIdForQuality(quality: GraphicsQuality): OpticsRecipeId {
	switch (quality) {
		case "high":
			return "match.high";
		case "medium":
			return "match.medium";
		case "deck":
			return "match.deck";
		case "low":
		default:
			return "match.low";
	}
}
