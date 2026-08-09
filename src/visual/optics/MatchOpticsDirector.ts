/**
 * MatchOpticsDirector — jedna recepta → światła / cienie / bloom / flary / snopy / blur.
 */

import * as THREE from "three";
import { KernelSize } from "postprocessing";

import type { GraphicsQuality } from "../../util/graphicsProfile";
import type { CinematicPostFx, PremiumFxInput } from "../cinematicPostFx";
import type { PremiumPostStack } from "../premiumPostStack";
import type { StadiumLightingRig } from "../stadiumLighting";
import {
	applyOpticsLights,
	applyShadowQuality,
} from "../stadiumLighting";
import type { LensFlareLight } from "../shaders/lensFlarePost";
import { getOpticsRecipe } from "./opticsRecipes";
import {
	type OpticsAtmosphereLayer,
	type OpticsDriveLayer,
	type OpticsFloodLayer,
	type OpticsMode,
	type OpticsRecipe,
	type OpticsSpectacleLayer,
	recipeIdForQuality,
} from "./opticsTypes";

export type MatchOpticsDirector = {
	setMode: (mode: OpticsMode, quality?: GraphicsQuality) => void;
	setQuality: (quality: GraphicsQuality) => void;
	bindLighting: (rig: StadiumLightingRig) => void;
	setDrive: (drive: OpticsDriveLayer) => void;
	setSpectacle: (s: OpticsSpectacleLayer) => void;
	setAtmosphere: (a: OpticsAtmosphereLayer) => void;
	setFlood: (f: OpticsFloodLayer) => void;
	setLensFlareLights: (lights: LensFlareLight[]) => void;
	/** Zastosuj receptę + warstwy (co klatkę lub po zmianie mode). */
	apply: (renderer: THREE.WebGLRenderer) => void;
	/** Motion/DoF input do cinematic (z recepty + drive). */
	fillPremiumFx: (out: PremiumFxInput, cameraForward: THREE.Vector3) => void;
	getRecipe: () => OpticsRecipe;
	getFlareIntensity: () => number;
	getShadowAutoUpdateEveryN: () => number;
};

function kernelSize(
	k: OpticsRecipe["bloom"]["kernel"],
): (typeof KernelSize)[keyof typeof KernelSize] {
	if (k === "medium") return KernelSize.MEDIUM;
	if (k === "small") return KernelSize.SMALL;
	return KernelSize.VERY_SMALL;
}

export function createMatchOpticsDirector(
	premium: PremiumPostStack,
	cinematic: CinematicPostFx,
): MatchOpticsDirector {
	let quality: GraphicsQuality = "high";
	let mode: OpticsMode = "match";
	let recipe = getOpticsRecipe(recipeIdForQuality(quality));
	let lighting: StadiumLightingRig | null = null;
	let drive: OpticsDriveLayer = { speedMps: 0, boosting: false };
	let spectacle: OpticsSpectacleLayer = { amount: 0 };
	let atmosphere: OpticsAtmosphereLayer = {
		exposureOffset: 0,
		coolGrade: 0,
		warmGrade: 0,
		bloomBias: 0,
	};
	let flood: OpticsFloodLayer = { active: false, mix: 0 };
	let flareLights: LensFlareLight[] = [];
	let shadowsAppliedFor = "";

	function resolveRecipe(): OpticsRecipe {
		if (mode === "menu") return getOpticsRecipe("menu");
		if (mode === "garage") return getOpticsRecipe("garage");
		return getOpticsRecipe(recipeIdForQuality(quality));
	}

	function syncRecipe(): void {
		recipe = resolveRecipe();
	}

	function flareIntensityNow(): number {
		const f = recipe.flares;
		if (!f.enabled) return 0;
		const speedNorm = THREE.MathUtils.clamp(drive.speedMps / 28, 0, 1);
		const driveOptics = speedNorm * 0.5 + (drive.boosting ? 0.45 : 0.22);
		return (
			f.baseIntensity +
			driveOptics * f.driveScale +
			(drive.boosting ? f.boostExtra : 0) +
			spectacle.amount * 0.12
		);
	}

	return {
		setMode(next, q) {
			mode = next;
			if (q) quality = q;
			syncRecipe();
			shadowsAppliedFor = "";
		},
		setQuality(q) {
			quality = q;
			syncRecipe();
			shadowsAppliedFor = "";
			cinematic.setPremiumScale(q);
		},
		bindLighting(rig) {
			/** Tylko zmiana riga — nie czyść co klatkę (to forowało applyShadowQuality). */
			if (lighting !== rig) {
				lighting = rig;
				shadowsAppliedFor = "";
			}
		},
		setDrive(d) {
			drive = d;
		},
		setSpectacle(s) {
			spectacle = s;
		},
		setAtmosphere(a) {
			atmosphere = a;
		},
		setFlood(f) {
			flood = f;
		},
		setLensFlareLights(lights) {
			flareLights = lights;
		},
		getRecipe() {
			return recipe;
		},
		getFlareIntensity() {
			return flareIntensityNow();
		},
		getShadowAutoUpdateEveryN() {
			return recipe.shadows.autoUpdateEveryN;
		},
		fillPremiumFx(out, cameraForward) {
			const b = recipe.blur;
			const speedNorm = THREE.MathUtils.clamp(
				(drive.speedMps - b.motionAtSpeedMps) / 18,
				0,
				1,
			);
			let mot =
				speedNorm * b.motionMax +
				(drive.boosting ? b.boostMotionExtra : 0);
			mot *= b.premiumScale;
			out.motionBlurStrength = mode === "match" ? mot : 0;
			out.motionBlurDir.set(-cameraForward.x, -cameraForward.y).normalize();
			/** Lekki DOF/bokeh w meczu — cinematic i tak chroni skybox. */
			out.dofStrength = b.dofBase * (mode === "match" ? 0.85 : 1);
		},
		apply(renderer) {
			syncRecipe();
			const r = recipe;
			const bloomExtra =
				THREE.MathUtils.clamp(atmosphere.bloomBias, 0, 0.05) * 0.08 +
				spectacle.amount * (mode === "match" ? 0.1 : 0.35);

			premium.setMatchLook(mode === "match");
			premium.setBloomEnabled(true);
			premium.setBloomStrength(r.bloom.intensity + bloomExtra);
			premium.setBloomThreshold(
				mode === "match"
					? Math.max(0.86, r.bloom.threshold - spectacle.amount * 0.05)
					: r.bloom.threshold,
			);
			premium.bloom.kernelSize = kernelSize(r.bloom.kernel);
			premium.bloom.luminanceMaterial.smoothing = r.bloom.smoothing;

			premium.setColorGrade(
				THREE.MathUtils.clamp(
					r.grade.cool + atmosphere.coolGrade,
					0,
					1.2,
				),
				THREE.MathUtils.clamp(
					r.grade.warm + atmosphere.warmGrade,
					0,
					1.2,
				),
				r.grade.saturation,
			);
			cinematic.setVignette(r.grade.vignette);
			cinematic.setSustainedGrades(
				atmosphere.coolGrade,
				atmosphere.warmGrade,
			);
			renderer.toneMappingExposure =
				r.grade.exposure + atmosphere.exposureOffset;

			const fi = flareIntensityNow();
			if (r.flares.enabled && flareLights.length > 0 && fi > 0.02) {
				premium.setLensFlares(flareLights, fi);
			} else {
				premium.setLensFlares([], 0);
			}

			if (lighting) {
				const lightRecipe = { ...r.lights };
				if (flood.active) {
					/** Flood: tylko moc świateł — mesh snopy zostają OFF (anty-mleko). */
					lightRecipe.jupiterMul *= 1 + flood.mix * 0.35;
					lightRecipe.cornerMul *= 1 + flood.mix * 0.4;
				}
				applyOpticsLights(lighting, lightRecipe);

				const shadowKey = `${r.id}:${r.shadows.primaryMapSize}:${r.shadows.jupiterShadowCount}`;
				if (shadowKey !== shadowsAppliedFor) {
					applyShadowQuality(lighting, r.shadows.primaryMapSize, r.shadows);
					shadowsAppliedFor = shadowKey;
				}
			}
		},
	};
}
