import * as THREE from "three";

import { LIGHTING_FILM } from "./lighting";
import type { StadiumLightingRig } from "./stadiumLighting";
import { STADIUM_PYLON_SPECS } from "./stadiumPylons";

const DEFAULT_CORNER_TARGETS = [
	new THREE.Vector3(-12, 0, 18),
	new THREE.Vector3(12, 0, -18),
];

const JUPITER_DEFAULT_TARGETS = STADIUM_PYLON_SPECS.map(
	(s) => new THREE.Vector3(...s.target),
);

const _focusPos = new THREE.Vector3();
const _ballAim = new THREE.Vector3();

let focusStrength = 0;
let focusTime = 0;

/** Reflektory + jupitery śledzą piłkę przy golu / supersonic / napięciu meczu. */
export function pulseArenaBallFocus(
	worldPos: THREE.Vector3,
	strength = 1,
	durationSec = 2.8,
): void {
	_focusPos.copy(worldPos);
	focusStrength = Math.max(
		focusStrength,
		THREE.MathUtils.clamp(strength, 0, 1),
	);
	focusTime = Math.max(focusTime, durationSec);
}

export function getArenaBallFocus(): { pos: THREE.Vector3; blend: number } {
	return { pos: _focusPos, blend: focusStrength };
}

export function updateArenaBallFocus(
	rig: StadiumLightingRig,
	dt: number,
	tension = 0,
	ballPos?: THREE.Vector3,
): void {
	if (ballPos && tension > 0.72) {
		pulseArenaBallFocus(ballPos, ((tension - 0.72) / 0.28) * 0.35, 0.14);
	}

	if (focusTime > 0) {
		focusTime = Math.max(0, focusTime - dt);
	} else {
		focusStrength = THREE.MathUtils.damp(focusStrength, 0, 5, dt);
	}

	if (focusStrength < 0.02) {
		focusStrength = 0;
		resetSpotTargets(rig);
		return;
	}

	_ballAim.set(_focusPos.x, Math.max(1.4, _focusPos.y + 0.6), _focusPos.z);
	const blend = focusStrength * 0.78;
	const spotLerp = 1 - Math.exp(-7 * dt);
	const jupiterLerp = 1 - Math.exp(-4.5 * dt);

	for (let i = 0; i < rig.cornerSpots.length; i++) {
		const spot = rig.cornerSpots[i]!;
		const def = DEFAULT_CORNER_TARGETS[i] ?? DEFAULT_CORNER_TARGETS[0]!;
		spot.target.position.lerpVectors(def, _ballAim, blend * spotLerp);
		const base = LIGHTING_FILM.cornerSpotIntensities[i] ?? 5;
		spot.intensity = base * (1 + blend * 0.85);
	}

	for (let i = 0; i < rig.pitchLights.length; i++) {
		const light = rig.pitchLights[i]!;
		const def = JUPITER_DEFAULT_TARGETS[i];
		if (def) {
			light.target.position.lerpVectors(
				def,
				_ballAim,
				blend * 0.42 * jupiterLerp,
			);
		}
		const base = LIGHTING_FILM.jupiterIntensities[i] ?? 1.2;
		light.intensity = base * (1 + blend * 0.18);
	}
}

function resetSpotTargets(rig: StadiumLightingRig): void {
	for (let i = 0; i < rig.cornerSpots.length; i++) {
		const spot = rig.cornerSpots[i]!;
		const def = DEFAULT_CORNER_TARGETS[i] ?? DEFAULT_CORNER_TARGETS[0]!;
		spot.target.position.copy(def);
		spot.intensity = LIGHTING_FILM.cornerSpotIntensities[i] ?? 5;
	}
	for (let i = 0; i < rig.pitchLights.length; i++) {
		const light = rig.pitchLights[i]!;
		const def = JUPITER_DEFAULT_TARGETS[i];
		if (def) light.target.position.copy(def);
		light.intensity = LIGHTING_FILM.jupiterIntensities[i] ?? 1.2;
	}
}
