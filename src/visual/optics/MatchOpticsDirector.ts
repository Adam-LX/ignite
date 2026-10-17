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
import { getArenaBallFocus } from "../arenaBallFocus";
import type { LensFlareLight } from "../shaders/lensFlarePost";
import { isPathTraceLookEnabled } from "../../util/presentationPrefs";
import { applyPathTraceShadowFeel } from "../pathTracing/pathTraceShadows";
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
	/** Prematch lasers — prawie wyłącz bloom, żeby RGB nie zbiegało w biel. */
	setLaserShowPreserveColor: (on: boolean) => void;
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
	let laserShowPreserveColor = false;
	let flareLights: LensFlareLight[] = [];
	let shadowsAppliedFor = "";
	/**
	 * Temporal smoothing for premium look stability.
	 * Avoid 1-frame pops when match state changes fast (goal flood / boost).
	 */
	let smoothedFlareIntensity = 0;
	let smoothedBloomStrength = recipe.bloom.intensity;
	let smoothedExposure = recipe.grade.exposure;
	let smoothedCool = recipe.grade.cool;
	let smoothedWarm = recipe.grade.warm;

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
		setLaserShowPreserveColor(on) {
			laserShowPreserveColor = on;
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
			out.dofStrength =
				b.dofBase *
				(mode === "match"
					? isPathTraceLookEnabled()
						? 0.45
						: 0.35
					: 1);
			let mot =
				speedNorm * b.motionMax +
				(drive.boosting ? b.boostMotionExtra : 0);
			mot *= b.premiumScale;
			if (mode === "match" && isPathTraceLookEnabled()) mot *= 0.95;
			else if (mode === "match") mot *= 0.55;
			out.motionBlurStrength = mode === "match" ? mot : 0;
			out.motionBlurDir.set(-cameraForward.x, -cameraForward.y).normalize();
		},
		apply(renderer) {
			syncRecipe();
			const r = recipe;
			const bloomExtra =
				THREE.MathUtils.clamp(atmosphere.bloomBias, 0, 0.03) * 0.05 +
				spectacle.amount * (mode === "match" ? 0.04 : 0.28);
			const smooth = mode === "match" ? 0.11 : 0.2;
			const pathTrace = isPathTraceLookEnabled();

			premium.setMatchLook(mode === "match");
			premium.setBloomEnabled(true);
			let targetBloom =
				(r.bloom.intensity + bloomExtra) *
				(pathTrace ? 0.78 : 0.32);
			let bloomThreshold =
				mode === "match"
					? pathTrace
						? Math.max(
								0.95,
								r.bloom.threshold + 0.02 - spectacle.amount * 0.015,
							)
						: Math.max(
								0.97,
								r.bloom.threshold - spectacle.amount * 0.01,
							)
					: r.bloom.threshold;
			if (laserShowPreserveColor) {
				/** Chromatic lasers: bloom ≈ off, wysoki próg. */
				targetBloom = Math.min(targetBloom, 0.015);
				bloomThreshold = Math.max(bloomThreshold, 0.99);
			}
			smoothedBloomStrength = THREE.MathUtils.lerp(
				smoothedBloomStrength,
				targetBloom,
				smooth,
			);
			premium.setBloomStrength(smoothedBloomStrength);
			premium.setBloomThreshold(bloomThreshold);
			premium.bloom.kernelSize = pathTrace
				? kernelSize("small")
				: kernelSize(r.bloom.kernel);
			/**
			 * Radius z recepty działa tylko na mipmap blur (Kawase ignoruje).
			 * PT: delikatny specular bleed — bez mydła na murawie.
			 */
			const useMip =
				mode === "match" &&
				(pathTrace ||
					r.bloom.kernel === "small" ||
					r.bloom.kernel === "medium");
			premium.bloom.mipmapBlurPass.enabled = useMip;
			if (useMip) {
				premium.bloom.mipmapBlurPass.radius = pathTrace
					? Math.max(r.bloom.radius, 0.28)
					: r.bloom.radius;
			}
			premium.bloom.luminanceMaterial.smoothing = pathTrace
				? 0.2
				: r.bloom.smoothing;

			const targetCool = THREE.MathUtils.clamp(
				r.grade.cool +
					atmosphere.coolGrade +
					(pathTrace && mode === "match" ? 0.04 : 0),
				0,
				1.2,
			);
			const targetWarm = THREE.MathUtils.clamp(
				r.grade.warm +
					atmosphere.warmGrade +
					(pathTrace && mode === "match" ? 0.038 : 0),
				0,
				1.2,
			);
			smoothedCool = THREE.MathUtils.lerp(smoothedCool, targetCool, smooth);
			smoothedWarm = THREE.MathUtils.lerp(smoothedWarm, targetWarm, smooth);
			premium.setColorGrade(
				smoothedCool,
				smoothedWarm,
				r.grade.saturation *
					(pathTrace && mode === "match"
						? 0.98
						: mode === "match"
							? 0.92
							: 1),
				mode === "match" ? (pathTrace ? 0.96 : 0.96) : 0.97,
			);
			cinematic.setVignette(
				r.grade.vignette *
					(pathTrace && mode === "match"
						? 1.35
						: mode === "match"
							? 0.75
							: 1),
			);
			cinematic.setSustainedGrades(
				atmosphere.coolGrade,
				atmosphere.warmGrade,
			);
			const targetExposure =
				(r.grade.exposure + atmosphere.exposureOffset) *
				(pathTrace && mode === "match"
					? 0.82
					: mode === "match"
						? 0.96
						: 1);
			smoothedExposure = THREE.MathUtils.lerp(
				smoothedExposure,
				targetExposure,
				smooth,
			);
			renderer.toneMappingExposure = smoothedExposure;

			const fi =
				flareIntensityNow() *
				(pathTrace ? 1.15 : 0.45);
			smoothedFlareIntensity = THREE.MathUtils.lerp(
				smoothedFlareIntensity,
				fi,
				smooth,
			);
			if (
				r.flares.enabled &&
				flareLights.length > 0 &&
				smoothedFlareIntensity > 0.02
			) {
				premium.setLensFlares(
					flareLights,
					smoothedFlareIntensity * r.flares.sourceWeightMul,
				);
			} else {
				smoothedFlareIntensity = 0;
				premium.setLensFlares([], 0);
			}

			if (lighting) {
				const lightRecipe = { ...r.lights };
				if (pathTrace) {
					/** Widowisko z kontrastem: snopy/gobo tak, fill nie myje cieni. */
					lightRecipe.hemiMul *= 0.95;
					lightRecipe.keyMul *= 1.02;
					lightRecipe.ambientMul *= 0.72;
					lightRecipe.goboMul *= 1.12;
					lightRecipe.cornerMul *= 1.02;
					lightRecipe.jupiterMul *= 1.0;
					lightRecipe.beamOpacity = Math.min(
						0.14,
						lightRecipe.beamOpacity * 1.15,
					);
					lightRecipe.beamsVisible = true;
				} else {
					/** Competitive raster: flat, czytelne, bez snopów. */
					lightRecipe.hemiMul *= 0.42;
					lightRecipe.ambientMul *= 0.62;
					lightRecipe.keyMul *= 0.92;
					lightRecipe.beamOpacity *= 0.12;
					lightRecipe.beamsVisible = false;
					lightRecipe.goboMul *= 0.45;
					lightRecipe.jupiterMul *= 0.85;
					lightRecipe.cornerMul *= 0.8;
				}
				if (flood.active) {
					/** Flood: tylko moc świateł — mesh snopy zostają OFF (anty-mleko). */
					lightRecipe.jupiterMul *= 1 + flood.mix * 0.35;
					lightRecipe.cornerMul *= 1 + flood.mix * 0.4;
					/**
					 * Anti-wash: przy mocnym floodzie zdejmij trochę fillu, żeby
					 * murawa i cienie nie znikały pod jednolitą białą poświatą.
					 */
					const fillCut = THREE.MathUtils.lerp(1, 0.84, flood.mix);
					lightRecipe.ambientMul *= fillCut;
					lightRecipe.hemiMul *= THREE.MathUtils.lerp(1, 0.88, flood.mix);
				}

				/**
				 * Nocny balans: gdy jupitery/cornery idą wysoko, lekko odejmij fill.
				 * Daje czytelniejszą murawę i mniej neon wash na bandach.
				 */
				const hotLights = THREE.MathUtils.clamp(
					((lightRecipe.jupiterMul + lightRecipe.cornerMul) * 0.5 - 1.3) / 0.5,
					0,
					1,
				);
				const antiWash = THREE.MathUtils.lerp(1, 0.9, hotLights);
				lightRecipe.ambientMul *= antiWash;
				lightRecipe.hemiMul *= THREE.MathUtils.lerp(1, 0.94, hotLights);
				applyOpticsLights(lighting, lightRecipe);

				/** Goal flood: team bounce GI — applyOpticsLights nie zna flood tint surge. */
				if (flood.active && flood.mix > 0.01) {
					for (let i = 0; i < lighting.bounceLights.length; i++) {
						const goalish = i < 2;
						const boost = goalish
							? 1 + flood.mix * 1.15
							: 1 + flood.mix * 0.55;
						lighting.bounceLights[i]!.intensity *= boost;
					}
				}

				/** Ball focus: bounce fill punch (po applyOpticsLights, przed renderem). */
				const focusBlend = getArenaBallFocus().blend;
				if (focusBlend > 0.02) {
					for (let i = 0; i < lighting.bounceLights.length; i++) {
						lighting.bounceLights[i]!.intensity *= 1 + focusBlend * 0.32;
					}
				}

				/** PT: bounce z umiarem — cienie zostają. */
				if (pathTrace) {
					for (let i = 0; i < lighting.bounceLights.length; i++) {
						lighting.bounceLights[i]!.intensity *= 0.92;
					}
				} else {
					for (let i = 0; i < lighting.bounceLights.length; i++) {
						lighting.bounceLights[i]!.intensity *= 0.55;
					}
				}

				const shadowOpts = {
					...r.shadows,
					primaryIntensity:
						(r.shadows.primaryIntensity ?? 0.9) *
						(pathTrace ? 1.35 : 0.72),
				};
				const shadowKey = `${r.id}:${shadowOpts.primaryMapSize}:${shadowOpts.jupiterShadowCount}:${shadowOpts.primaryRadius}:${shadowOpts.primaryIntensity}:${pathTrace}`;
				if (shadowKey !== shadowsAppliedFor) {
					applyShadowQuality(lighting, shadowOpts.primaryMapSize, shadowOpts);
					applyPathTraceShadowFeel(lighting);
					shadowsAppliedFor = shadowKey;
				}
			}
		},
	};
}
