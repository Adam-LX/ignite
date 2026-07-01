import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	computePlayerTppTarget,
	sampleChaseCameraTargets,
	updatePlayerTppCamera,
} from "../../src/visual/cameraFollow";

describe("cameraFollow free cam", () => {
	const carPos = new THREE.Vector3(0, 0, 0);
	const ballPos = new THREE.Vector3(30, 0, 0);
	const forward = new THREE.Vector3(0, 0, 1);

	it("places free cam behind car along car forward, not ball line", () => {
		const free = computePlayerTppTarget(
			carPos,
			ballPos,
			forward,
			5,
			false,
		).clone();
		const ball = computePlayerTppTarget(
			carPos,
			ballPos,
			forward,
			5,
			true,
		).clone();

		expect(free.x).toBeCloseTo(0, 5);
		expect(free.z).toBeCloseTo(-5, 5);
		expect(ball.x).toBeLessThan(0);
		expect(ball.z).toBeCloseTo(0, 5);
	});

	it("looks ahead in car forward direction in free cam", () => {
		const free = sampleChaseCameraTargets(
			carPos,
			forward,
			ballPos,
			false,
		).lookAt.clone();
		const ball = sampleChaseCameraTargets(
			carPos,
			forward,
			ballPos,
			true,
		).lookAt.clone();

		expect(free.z).toBeGreaterThan(5);
		expect(free.x).toBeCloseTo(0, 5);
		expect(ball.x).toBeGreaterThan(5);
	});

	it("free cam nie obraca się podczas flipa (zamrożony heading)", () => {
		const state = {
			initialized: true,
			currentHorizontalFov: 100,
			shakeIntensity: 0,
			lastFlatForward: new THREE.Vector3(0, 0, 1),
		};
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const carQuat = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(1.1, 0, 0, "YXZ"),
		);

		updatePlayerTppCamera(
			camera,
			carPos,
			ballPos,
			carQuat,
			1 / 60,
			state,
			false,
			true,
		);

		expect(state.lastFlatForward.x).toBeCloseTo(0, 5);
		expect(state.lastFlatForward.z).toBeCloseTo(1, 5);
	});
});
