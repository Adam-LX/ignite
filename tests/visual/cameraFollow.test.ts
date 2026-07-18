import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	applyPlayerScreenFraming,
	applySpeedLeadToTarget,
	clampLookAtPitch,
	computePlayerTppTarget,
	createChaseCameraState,
	isCarInCameraFrustum,
	PLAYER_FRAME,
	sampleChaseCameraTargets,
	smoothDampScalar,
	updateChaseCamera,
	updatePlayerTppCamera,
} from "../../src/visual/cameraFollow";
import { RL_CAR } from "../../src/util/rlConstants";

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
		const state = createChaseCameraState();
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

	it("free cam utrzymuje pitch patrzenia gdy auto się przewraca", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const flatQuat = new THREE.Quaternion();

		updatePlayerTppCamera(
			camera,
			new THREE.Vector3(0, 1, 0),
			ballPos,
			flatQuat,
			1 / 60,
			state,
			false,
			false,
		);

		const pitchBefore = new THREE.Vector3();
		camera.getWorldDirection(pitchBefore);

		const pitchedQuat = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(1.35, 0.4, 0, "YXZ"),
		);
		updatePlayerTppCamera(
			camera,
			new THREE.Vector3(0, 0.4, 0),
			ballPos,
			pitchedQuat,
			1 / 60,
			state,
			false,
			true,
		);

		const pitchAfter = new THREE.Vector3();
		camera.getWorldDirection(pitchAfter);
		expect(state.flipCamActive).toBe(true);
		expect(Math.abs(pitchAfter.y - pitchBefore.y)).toBeLessThan(0.08);
	});
});

describe("smoothDampScalar", () => {
	it("zbliża się do celu bez skoków", () => {
		const vel = { value: 0 };
		let x = 0;
		for (let i = 0; i < 120; i++) {
			x = smoothDampScalar(x, 10, vel, 0.12, 1 / 60);
		}
		expect(x).toBeGreaterThan(9.2);
		expect(x).toBeLessThan(10.05);
	});
});

describe("player screen framing", () => {
	it("speed lead przesuwa target kamery do przodu", () => {
		const target = new THREE.Vector3(0, 2, -6);
		const vel = new THREE.Vector3(0, 0, RL_CAR.maxSpeed);
		applySpeedLeadToTarget(target, vel, true);
		expect(target.z).toBeGreaterThan(-6);
	});

	it("framing podnosi auto w kadrze gdy jest za nisko (NDC)", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const carPos = new THREE.Vector3(0, 0.35, 0);
		camera.position.set(0, 2.4, -7);
		/** Patrzy za wysoko → auto nisko w NDC, z zapasem do pitch clamp. */
		camera.lookAt(0, 1.7, 0);
		state.smoothedLookAt.set(0, 1.7, 0);
		camera.updateMatrixWorld(true);

		const before = carPos.clone().project(camera);
		expect(before.y).toBeLessThan(PLAYER_FRAME.minY);
		for (let i = 0; i < 120; i++) {
			applyPlayerScreenFraming(camera, carPos, state, 1 / 60, 0);
		}
		const after = carPos.clone().project(camera);
		expect(after.y).toBeGreaterThan(before.y);
	});

	it("framing dociąga auto bliżej środka kadru (NDC X)", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const carPos = new THREE.Vector3(0, 0.5, 0);
		camera.position.set(0, 2.25, -6.2);
		/** Look mocno w prawo → auto po lewej w NDC. */
		camera.lookAt(4.5, 0.7, 0);
		state.smoothedLookAt.set(4.5, 0.7, 0);
		camera.updateMatrixWorld(true);

		const before = carPos.clone().project(camera);
		expect(Math.abs(before.x)).toBeGreaterThan(0.25);
		for (let i = 0; i < 150; i++) {
			applyPlayerScreenFraming(camera, carPos, state, 1 / 60, 0);
		}
		const after = carPos.clone().project(camera);
		expect(Math.abs(after.x)).toBeLessThan(Math.abs(before.x));
		expect(Math.abs(after.x)).toBeLessThan(PLAYER_FRAME.maxAbsX + 0.08);
	});

	it("clampLookAtPitch nie pozwala stromiej niż maxPitchDownDeg", () => {
		const camPos = new THREE.Vector3(0, 2.25, -6.2);
		const lookAt = new THREE.Vector3(0, -20, 0);
		clampLookAtPitch(camPos, lookAt);
		const horiz = Math.hypot(lookAt.x - camPos.x, lookAt.z - camPos.z);
		const pitchDeg =
			(Math.atan2(lookAt.y - camPos.y, horiz) * 180) / Math.PI;
		expect(pitchDeg).toBeGreaterThanOrEqual(PLAYER_FRAME.maxPitchDownDeg - 0.05);
	});

	it("przy wysokiej prędkości framing nie topi horyzontu poniżej limitu pitch", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const carPos = new THREE.Vector3(0, 0.35, 0);
		camera.position.set(0, 2.25, -6.2);
		camera.lookAt(0, 0.62, 0);
		state.smoothedLookAt.set(0, 0.62, 0);
		camera.updateMatrixWorld(true);

		for (let i = 0; i < 180; i++) {
			applyPlayerScreenFraming(
				camera,
				carPos,
				state,
				1 / 60,
				RL_CAR.maxSpeed,
			);
		}
		const dir = new THREE.Vector3();
		camera.getWorldDirection(dir);
		const pitchDeg =
			(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) * 180) / Math.PI;
		expect(pitchDeg).toBeGreaterThanOrEqual(PLAYER_FRAME.maxPitchDownDeg - 0.5);
	});

	it("updateChaseCamera trzyma auto w frustum przy boost", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.1, 500);
		const carPos = new THREE.Vector3(0, 0.4, 0);
		/** Piłka przed autem — realistyczny boost w dribble / challenge. */
		const ballPos = new THREE.Vector3(0, 0, 18);
		const carQuat = new THREE.Quaternion();
		const vel = new THREE.Vector3(0, 0, RL_CAR.maxSpeed * 0.95);

		for (let i = 0; i < 180; i++) {
			carPos.z += vel.z * (1 / 60);
			ballPos.z = carPos.z + 18;
			updateChaseCamera(
				camera,
				carPos,
				carQuat,
				ballPos,
				true,
				1 / 60,
				true,
				vel.length(),
				state,
				undefined,
				vel.z,
				0,
				0,
				false,
				vel,
			);
		}

		expect(isCarInCameraFrustum(camera, carPos, 0.1)).toBe(true);
	});

	it("updateChaseCamera płynnie goni auto przy boost+skręcie (bez snap-jitter)", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.1, 500);
		const carPos = new THREE.Vector3(0, 0.4, 0);
		const ballPos = new THREE.Vector3(0, 0, 20);
		const carQuat = new THREE.Quaternion();
		const vel = new THREE.Vector3();
		const yawAxis = new THREE.Vector3(0, 1, 0);
		let yaw = 0;
		const dt = 1 / 60;
		const spd = RL_CAR.maxSpeed * 0.9;
		let maxJump = 0;
		const prevCam = new THREE.Vector3();

		for (let i = 0; i < 180; i++) {
			yaw += 1.2 * dt;
			carQuat.setFromAxisAngle(yawAxis, yaw);
			vel.set(Math.sin(yaw) * spd, 0, Math.cos(yaw) * spd);
			carPos.x += vel.x * dt;
			carPos.z += vel.z * dt;
			ballPos.set(
				carPos.x + Math.sin(yaw) * 16,
				0,
				carPos.z + Math.cos(yaw) * 16,
			);

			prevCam.copy(camera.position);
			updateChaseCamera(
				camera,
				carPos,
				carQuat,
				ballPos,
				true,
				dt,
				true,
				spd,
				state,
				undefined,
				spd,
				0,
				0,
				false,
				vel,
			);
			if (i > 5) {
				maxJump = Math.max(maxJump, camera.position.distanceTo(prevCam));
			}
		}

		/** Brak klatkowych snapów (jitter) — ruch kamery ograniczony. */
		expect(maxJump).toBeLessThan(2.8);
		expect(isCarInCameraFrustum(camera, carPos, 0.15)).toBe(true);
	});
});
