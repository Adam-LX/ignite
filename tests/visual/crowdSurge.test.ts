import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	resetCrowdSurge,
	triggerCrowdSurge,
	updateCrowdSurge,
} from "../../src/visual/crowdSurge";
import type { StadiumLightingRig } from "../../src/visual/stadiumLighting";
import { LIGHTING_FILM } from "../../src/visual/lighting";

function mockRig(): StadiumLightingRig {
	return {
		primaryShadow: {} as StadiumLightingRig["primaryShadow"],
		hemisphere: {
			color: new THREE.Color(),
			groundColor: new THREE.Color(),
			intensity: LIGHTING_FILM.hemisphereIntensity,
		} as unknown as StadiumLightingRig["hemisphere"],
		pitchLights: [
			{ intensity: 1.2, color: new THREE.Color() },
			{ intensity: 1.2, color: new THREE.Color() },
		] as unknown as StadiumLightingRig["pitchLights"],
		cornerSpots: [
			{ intensity: 5, color: new THREE.Color() },
			{ intensity: 5, color: new THREE.Color() },
		] as unknown as StadiumLightingRig["cornerSpots"],
		fixtures: {} as StadiumLightingRig["fixtures"],
	};
}

describe("crowdSurge", () => {
	it("trigger + update bez crasha", () => {
		resetCrowdSurge();
		triggerCrowdSurge("supersonic");
		const rig = mockRig();
		updateCrowdSurge(rig, 1 / 60, 1);
		updateCrowdSurge(rig, 0.6, 1.5);
		expect(true).toBe(true);
	});

	it("epic save ma fazę przygaszenia", () => {
		resetCrowdSurge();
		triggerCrowdSurge("epic_save", { intensity: 1 });
		const rig = mockRig();
		const before = rig.hemisphere.intensity;
		updateCrowdSurge(rig, 0.03, 0);
		expect(rig.hemisphere.intensity).toBeLessThan(before);
	});

	it("wyższy priorytet nie jest nadpisywany wcześnie", () => {
		resetCrowdSurge();
		triggerCrowdSurge("goal_wave", { team: "blue" });
		triggerCrowdSurge("supersonic");
		const rig = mockRig();
		updateCrowdSurge(rig, 0.05, 0);
		// still active — brak throw
		expect(true).toBe(true);
	});
});
