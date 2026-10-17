/**
 * Dynamiczna mokra murawa — roughness / IBL / clearcoat.
 *
 * PT OFF  → stary competitive raster (czytelny, jaśniejszy mat).
 * PT ON   → mokra, szczegółowa murawa + planar (bez czarnej tafli).
 */

import * as THREE from "three";

import { isPathTraceLookEnabled } from "../util/presentationPrefs";
import {
	pitchFloorMaterial,
	isPitchFloorBladeCarpetMode,
	setPitchFloorBladeCarpetMode,
} from "./materials";

let wetAmount = 0;
let lastWetInput = 0;
let baseApplied = false;
let lastCarpetMode = false;
let lastPathTrace: boolean | null = null;

/** Competitive / PT OFF — sucha, jasna, czytelna. */
const DRY_COMPETITIVE = {
	roughness: 0.62,
	envMapIntensity: 0.55,
	clearcoat: 0.1,
	clearcoatRoughness: 0.48,
} as const;

const DRY_CARPET = {
	roughness: 0.72,
	envMapIntensity: 0.4,
	clearcoat: 0.06,
	clearcoatRoughness: 0.58,
} as const;

/**
 * PT ON — wet look, ale clearcoat poniżej „lustra”
 * (za wysoki clearcoat zjada diffuse = ciemna murawa).
 */
/** Clearcoat umiarkowany — za wysoki zjada chlorophyll diffuse. */
const WET_SPECTACLE = {
	roughness: 0.52,
	envMapIntensity: 0.72,
	clearcoat: 0.1,
	clearcoatRoughness: 0.4,
} as const;

const WET_SPECTACLE_CARPET = {
	roughness: 0.55,
	envMapIntensity: 0.68,
	clearcoat: 0.1,
	clearcoatRoughness: 0.38,
} as const;

function asPhysical(
	mat: THREE.MeshStandardMaterial,
): THREE.MeshPhysicalMaterial | null {
	return mat instanceof THREE.MeshPhysicalMaterial ? mat : null;
}

function liftPitchAlbedo(
	mat: THREE.MeshStandardMaterial,
	pathTrace: boolean,
): void {
	/** Żywy stadium green — jasny, nadal czytelny pod wet/clearcoat. */
	mat.color.setHex(pathTrace ? 0x9cbc52 : 0x94b44c);
	mat.aoMapIntensity = pathTrace ? 0.28 : 0.32;
	mat.needsUpdate = true;
}

/** Jednorazowo podbij bazę dry (po utworzeniu materiału). */
export function ensurePitchReflectionBaseline(): void {
	const mat = pitchFloorMaterial();
	if (baseApplied) return;
	baseApplied = true;
	const dry = isPitchFloorBladeCarpetMode() ? DRY_CARPET : DRY_COMPETITIVE;
	mat.roughness = dry.roughness;
	mat.envMapIntensity = dry.envMapIntensity;
	const phys = asPhysical(mat);
	if (phys) {
		phys.clearcoat = dry.clearcoat;
		phys.clearcoatRoughness = dry.clearcoatRoughness;
		phys.reflectivity = 0.32;
	}
}

/**
 * @param wet 0 = sucho, 1 = ulewny deszcz (WeatherSystem.intensity)
 */
export function applyPitchWetness(wet: number): void {
	ensurePitchReflectionBaseline();
	const t = THREE.MathUtils.clamp(wet, 0, 1);
	const carpet = isPitchFloorBladeCarpetMode();
	const pathTrace = isPathTraceLookEnabled();

	let u: number;
	if (pathTrace) {
		u = THREE.MathUtils.clamp(0.42 + t * 0.4, 0, 1);
	} else {
		u = THREE.MathUtils.clamp(t * 0.35, 0, 0.35);
	}

	if (
		Math.abs(u - wetAmount) < 0.004 &&
		carpet === lastCarpetMode &&
		pathTrace === lastPathTrace
	) {
		return;
	}
	lastWetInput = wet;
	wetAmount = u;
	lastCarpetMode = carpet;
	lastPathTrace = pathTrace;

	const dry = carpet ? DRY_CARPET : DRY_COMPETITIVE;
	const wetP = carpet ? WET_SPECTACLE_CARPET : WET_SPECTACLE;

	const mat = pitchFloorMaterial();
	liftPitchAlbedo(mat, pathTrace);
	mat.roughness = THREE.MathUtils.lerp(dry.roughness, wetP.roughness, u);
	mat.envMapIntensity = THREE.MathUtils.lerp(
		dry.envMapIntensity,
		wetP.envMapIntensity,
		u,
	);
	const phys = asPhysical(mat);
	if (phys) {
		phys.clearcoat = THREE.MathUtils.lerp(dry.clearcoat, wetP.clearcoat, u);
		phys.clearcoatRoughness = THREE.MathUtils.lerp(
			dry.clearcoatRoughness,
			wetP.clearcoatRoughness,
			u,
		);
		phys.reflectivity = pathTrace
			? THREE.MathUtils.lerp(0.28, 0.48, u)
			: 0.28;
	}

	if (pathTrace) {
		mat.envMapIntensity *= carpet ? 0.95 : 0.98;
		if (phys) {
			phys.clearcoat = Math.min(0.38, phys.clearcoat);
			phys.clearcoatRoughness = Math.max(0.14, phys.clearcoatRoughness);
			phys.reflectivity = Math.min(0.34, phys.reflectivity);
		}
		const n = mat.normalScale;
		n.set(Math.max(n.x, 1.55), Math.max(n.y, 1.55));
	} else {
		mat.envMapIntensity *= 0.75;
		mat.roughness = Math.min(0.85, mat.roughness + 0.04);
		if (phys) {
			phys.clearcoat *= 0.45;
			phys.clearcoatRoughness = Math.min(0.75, phys.clearcoatRoughness + 0.1);
			phys.reflectivity = 0.22;
		}
	}
}

/** Po toggle w opcjach — wymuś przeliczenie IBL murawy. */
export function refreshPitchLookForPrefs(): void {
	wetAmount = -1;
	lastPathTrace = null;
	setPitchFloorBladeCarpetMode(isPitchFloorBladeCarpetMode());
	applyPitchWetness(lastWetInput);
}

export function getPitchWetness(): number {
	return wetAmount;
}
