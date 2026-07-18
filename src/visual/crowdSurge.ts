import * as THREE from "three";

import type { ScoringTeam } from "../game/modes";
import { getStadiumLeds } from "./arena";
import { LIGHTING_FILM } from "./lighting";
import { RL } from "./materials";
import { perimeterLEDs } from "./perimeter/PerimeterLEDs";
import type { StadiumLightingRig } from "./stadiumLighting";

export type CrowdSurgeKind =
	| "supersonic"
	| "demolish"
	| "epic_save"
	| "power_shot"
	| "match_moment"
	| "goal_wave";

type ActiveSurge = {
	kind: CrowdSurgeKind;
	elapsed: number;
	duration: number;
	intensity: number;
	color: THREE.Color;
};

const _cornerA = new THREE.Color(0xc8e8ff);
const _cornerB = new THREE.Color(0xffe0c0);
const _hemiSky = new THREE.Color(LIGHTING_FILM.hemisphereSky);
const _hemiGround = new THREE.Color(LIGHTING_FILM.hemisphereGround);

const SURGE_COLORS: Record<CrowdSurgeKind, number> = {
	supersonic: 0x78ffff,
	demolish: 0xff4428,
	epic_save: 0x48ffd8,
	power_shot: 0xffaa44,
	match_moment: 0xffdd66,
	goal_wave: RL.goalBlue,
};

const SURGE_DURATION: Record<CrowdSurgeKind, number> = {
	supersonic: 0.58,
	demolish: 0.72,
	epic_save: 0.88,
	power_shot: 0.62,
	match_moment: 0.92,
	goal_wave: 1.48,
};

const SURGE_PRIORITY: Record<CrowdSurgeKind, number> = {
	goal_wave: 6,
	epic_save: 5,
	demolish: 4,
	match_moment: 4,
	power_shot: 3,
	supersonic: 2,
};

let activeSurge: ActiveSurge | null = null;

/** Kinetyczna reakcja stadionu — fala LED / reflektorów na highlight. */
export function triggerCrowdSurge(
	kind: CrowdSurgeKind,
	opts?: { intensity?: number; team?: ScoringTeam },
): void {
	const nextPriority = SURGE_PRIORITY[kind];
	const curPriority = activeSurge ? SURGE_PRIORITY[activeSurge.kind] : 0;
	if (
		activeSurge &&
		curPriority > nextPriority &&
		activeSurge.elapsed < activeSurge.duration * 0.45
	) {
		return;
	}

	let color = SURGE_COLORS[kind];
	if (kind === "goal_wave" && opts?.team === "orange") {
		color = RL.goalOrange;
	}

	activeSurge = {
		kind,
		elapsed: 0,
		duration: SURGE_DURATION[kind],
		intensity: THREE.MathUtils.clamp(opts?.intensity ?? 1, 0.35, 1.25),
		color: new THREE.Color(color),
	};

	getStadiumLeds()?.beginSurge(activeSurge.color, activeSurge.intensity);
	perimeterLEDs.beginSurge(activeSurge.color, activeSurge.intensity, kind);
}

export function updateCrowdSurge(
	rig: StadiumLightingRig | undefined,
	dt: number,
	timeSec: number,
): void {
	if (!activeSurge) return;

	activeSurge.elapsed += dt;
	const tNorm = activeSurge.elapsed / activeSurge.duration;
	if (tNorm >= 1) {
		activeSurge = null;
		getStadiumLeds()?.endSurge();
		perimeterLEDs.endSurge();
		return;
	}

	const envelope = surgeEnvelope(activeSurge);
	if (rig && envelope.mix !== 0) {
		applyLightingSurge(rig, activeSurge, envelope, timeSec);
	}

	getStadiumLeds()?.updateSurge(activeSurge, envelope, timeSec);
	perimeterLEDs.updateSurge(activeSurge, envelope, timeSec);
}

function surgeEnvelope(surge: ActiveSurge): { mix: number; wave: number } {
	const t = surge.elapsed;
	const d = surge.duration;
	const k = surge.intensity;

	switch (surge.kind) {
		case "epic_save": {
			if (t < 0.07) {
				return { mix: -0.42 * k * (1 - t / 0.07), wave: 0 };
			}
			if (t < 0.32) {
				const burst = (t - 0.07) / 0.25;
				return { mix: k * (0.35 + burst * 0.95), wave: burst };
			}
			return {
				mix: k * Math.max(0, 1 - (t - 0.32) / (d - 0.32)) * 0.55,
				wave: 1,
			};
		}
		case "demolish":
			return {
				mix:
					k * (t < 0.08 ? t / 0.08 : Math.max(0, 1 - (t - 0.08) / (d - 0.08))),
				wave: t / d,
			};
		case "supersonic":
			return {
				mix:
					k * (1 - tNorm(surge)) * (0.55 + 0.45 * Math.sin(surge.elapsed * 22)),
				wave: surge.elapsed * 6.5,
			};
		case "power_shot":
			return {
				mix:
					k *
					Math.sin(Math.min(1, t / 0.18) * Math.PI) *
					(1 - tNorm(surge) * 0.35),
				wave: t * 4,
			};
		default:
			return {
				mix: k * (1 - tNorm(surge)) * (0.65 + 0.35 * Math.sin(t * 14)),
				wave: t * 3.2,
			};
	}
}

function tNorm(surge: ActiveSurge): number {
	return THREE.MathUtils.clamp(surge.elapsed / surge.duration, 0, 1);
}

function applyLightingSurge(
	rig: StadiumLightingRig,
	surge: ActiveSurge,
	envelope: { mix: number; wave: number },
	timeSec: number,
): void {
	const mix = envelope.mix;
	const wave = envelope.wave;

	if (mix < 0) {
		const dim = 1 + mix;
		rig.hemisphere.intensity = LIGHTING_FILM.hemisphereIntensity * dim;
		for (let i = 0; i < rig.cornerSpots.length; i++) {
			const base = LIGHTING_FILM.cornerSpotIntensities[i] ?? 5;
			rig.cornerSpots[i]!.intensity = base * dim;
		}
		return;
	}

	rig.hemisphere.color.copy(_hemiSky).lerp(surge.color, 0.48 * mix);
	rig.hemisphere.groundColor.copy(_hemiGround).lerp(surge.color, 0.32 * mix);
	rig.hemisphere.intensity = LIGHTING_FILM.hemisphereIntensity + 0.42 * mix;

	for (let i = 0; i < rig.cornerSpots.length; i++) {
		const base = LIGHTING_FILM.cornerSpotIntensities[i] ?? 5;
		const travel =
			surge.kind === "supersonic" || surge.kind === "demolish"
				? 0.35 + 0.65 * Math.sin(wave + i * 1.35 + timeSec * 0.4)
				: 0.75 + 0.25 * Math.sin(wave + i);
		rig.cornerSpots[i]!.intensity = base * (1 + 0.95 * mix * travel);
		const spotBase = i === 0 ? _cornerA : _cornerB;
		rig.cornerSpots[i]!.color.copy(spotBase).lerp(surge.color, mix * 0.78);
	}

	for (let i = 0; i < rig.pitchLights.length; i++) {
		const base = LIGHTING_FILM.jupiterIntensities[i] ?? 1.2;
		const sweep =
			surge.kind === "supersonic"
				? 0.4 + 0.6 * Math.max(0, Math.sin(wave - i * 0.95))
				: 0.85 + 0.15 * Math.sin(wave + i);
		rig.pitchLights[i]!.intensity = base * (1 + 0.75 * mix * sweep);
	}
}

export function resetCrowdSurge(): void {
	activeSurge = null;
	getStadiumLeds()?.endSurge();
	perimeterLEDs.endSurge();
}
