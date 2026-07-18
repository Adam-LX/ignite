import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	createChaseCameraState,
	resetChaseCameraHeading,
} from "../../src/visual/cameraFollow";

describe("resetChaseCameraHeading", () => {
	it("czyści flip-lock i ustawia płaski heading auta", () => {
		const state = createChaseCameraState();
		state.flipCamActive = true;
		state.flipCamLookY = 2.5;
		state.flipCamHeightY = 1.2;
		state.shakeIntensity = 0.8;
		state.initialized = true;

		const carQuat = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0, Math.PI / 2, 0, "YXZ"),
		);
		resetChaseCameraHeading(state, carQuat);

		expect(state.flipCamActive).toBe(false);
		expect(state.flipCamLookY).toBe(0);
		expect(state.flipCamHeightY).toBe(0);
		expect(state.shakeIntensity).toBe(0);
		expect(state.initialized).toBe(false);
		expect(state.lastFlatForward.x).toBeCloseTo(1, 5);
		expect(state.lastFlatForward.z).toBeCloseTo(0, 5);
	});
});
