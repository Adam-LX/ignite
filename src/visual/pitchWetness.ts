/**
 * Dynamiczna mokra murawa — roughness / IBL / clearcoat pod deszcz i „premium wet”.
 * Planar SSR (pitchSsr) dokłada odbicia aut/piłki; tu PBR respond na światła.
 */

import * as THREE from "three";

import { pitchFloorMaterial, isPitchFloorBladeCarpetMode } from "./materials";

let wetAmount = 0;
let baseApplied = false;
let lastCarpetMode = false;

const DRY = {
	roughness: 0.48,
	envMapIntensity: 0.72,
	clearcoat: 0.34,
	clearcoatRoughness: 0.26,
} as const;

/** Pod dywanem źdźbeł — matowa baza, bez plastycznej fali. */
const DRY_CARPET = {
	roughness: 0.78,
	envMapIntensity: 0.32,
	clearcoat: 0.06,
	clearcoatRoughness: 0.62,
} as const;

const WET = {
	roughness: 0.26,
	envMapIntensity: 1.15,
	clearcoat: 0.62,
	clearcoatRoughness: 0.11,
} as const;

const WET_CARPET = {
	roughness: 0.55,
	envMapIntensity: 0.55,
	clearcoat: 0.18,
	clearcoatRoughness: 0.4,
} as const;

function asPhysical(
	mat: THREE.MeshStandardMaterial,
): THREE.MeshPhysicalMaterial | null {
	return mat instanceof THREE.MeshPhysicalMaterial ? mat : null;
}

/** Jednorazowo podbij bazę dry (po utworzeniu materiału). */
export function ensurePitchReflectionBaseline(): void {
	const mat = pitchFloorMaterial();
	if (baseApplied) return;
	baseApplied = true;
	const dry = isPitchFloorBladeCarpetMode() ? DRY_CARPET : DRY;
	mat.roughness = dry.roughness;
	mat.envMapIntensity = dry.envMapIntensity;
	const phys = asPhysical(mat);
	if (phys) {
		phys.clearcoat = dry.clearcoat;
		phys.clearcoatRoughness = dry.clearcoatRoughness;
		phys.reflectivity = 0.42;
	}
}

/**
 * @param wet 0 = sucho, 1 = ulewny deszcz (WeatherSystem.intensity)
 */
export function applyPitchWetness(wet: number): void {
	ensurePitchReflectionBaseline();
	const t = THREE.MathUtils.clamp(wet, 0, 1);
	/** Sucho prawie matowe — wet tylko przy deszczu (bez plam specular). */
	const u = THREE.MathUtils.clamp(0.04 + t * 0.96, 0, 1);
	const carpet = isPitchFloorBladeCarpetMode();
	if (Math.abs(u - wetAmount) < 0.004 && carpet === lastCarpetMode) return;
	wetAmount = u;
	lastCarpetMode = carpet;

	const dry = carpet ? DRY_CARPET : DRY;
	const wetP = carpet ? WET_CARPET : WET;

	const mat = pitchFloorMaterial();
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
	}
}

export function getPitchWetness(): number {
	return wetAmount;
}
