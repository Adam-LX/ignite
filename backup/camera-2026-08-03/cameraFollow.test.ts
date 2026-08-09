import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	applyPlayerScreenFraming,
	applySpeedLeadToTarget,
	BASE_FOV,
	clampCameraInsideSoccar,
	clampLookAtPitch,
	computePlayerTppTarget,
	createChaseCameraState,
	enforceMinCameraDistXZ,
	horizontalFovForAspect,
	horizontalFovToVertical,
	isCarInCameraFrustum,
	PLAYER_FRAME,
	sampleChaseCameraTargets,
	sampleCountdownChaseCameraTargets,
	sampleKickoffChaseCameraTargets,
	smoothDampScalar,
	updateChaseCamera,
	updatePlayerTppCamera,
} from "../../src/visual/cameraFollow";
import { RL_CAMERA, RL_CAR } from "../../src/util/rlConstants";

describe("cameraFollow FOV aspect", () => {
	it("trzyma vFOV jak @ 16:9 na ultrawide (bez fisheye +26°)", () => {
		const aspectUw = 3440 / 1440;
		const hUw = horizontalFovForAspect(RL_CAMERA.horizontalFov, aspectUw);
		const vUw = horizontalFovToVertical(hUw, aspectUw);
		const v169 = horizontalFovToVertical(
			RL_CAMERA.horizontalFov,
			16 / 9,
		);
		expect(Math.abs(vUw - v169)).toBeLessThan(0.05);
		/** Stary boost dawał ~127° — cap sensowny pod Medal/UW. */
		expect(hUw).toBeLessThan(120);
		expect(hUw).toBeGreaterThan(RL_CAMERA.horizontalFov);
	});

	it("FREE CAM używa tego samego dystansu co Ball Cam", () => {
		const carPos = new THREE.Vector3(0, 0.35, 0);
		const ballPos = new THREE.Vector3(20, 1, 0);
		const forward = new THREE.Vector3(0, 0, 1);
		const free = sampleChaseCameraTargets(
			carPos,
			forward,
			ballPos,
			false,
		).targetPos;
		const ball = sampleChaseCameraTargets(
			carPos,
			forward,
			ballPos,
			true,
		).targetPos;
		const freeDist = Math.hypot(free.x - carPos.x, free.z - carPos.z);
		const ballDist = Math.hypot(ball.x - carPos.x, ball.z - carPos.z);
		expect(Math.abs(freeDist - ballDist)).toBeLessThan(0.05);
		expect(freeDist).toBeCloseTo(RL_CAMERA.distance, 1);
		/** Regresja: 7.4 m = auto-mysz na UW. */
		expect(freeDist).toBeLessThan(4.5);
	});
});

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
		/**
		 * Ball cam = czysto za autem (−forward). Ball-line psuje diagonal/UW.
		 */
		expect(ball.z).toBeCloseTo(-5, 5);
		expect(Math.abs(ball.x)).toBeLessThan(0.01);
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

		expect(free.z).toBeGreaterThan(1.5);
		expect(free.z).toBeLessThan(5);
		expect(free.x).toBeCloseTo(0, 5);
		/** Ball cam: look ahead; yaw do piłki śladowy (nie midfield). */
		expect(Math.abs(ball.x)).toBeLessThan(1.5);
		expect(ball.z).toBeGreaterThan(0.5);
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

	it("airborne + pitch (W/S) nie zmienia kąta patrzenia kamery", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const car = new THREE.Vector3(0, 1, 0);
		const ball = new THREE.Vector3(20, 1, 40);
		const yaw0 = 0.35;
		const quat = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0, yaw0, 0, "YXZ"),
		);
		const vel = new THREE.Vector3(Math.sin(yaw0) * 12, 0, Math.cos(yaw0) * 12);

		for (let i = 0; i < 40; i++) {
			updateChaseCamera(
				camera,
				car,
				quat,
				ball,
				true,
				1 / 60,
				false,
				12,
				state,
				BASE_FOV,
				12,
				4,
				0,
				false,
				vel,
				1,
				true,
			);
		}
		const dirBefore = new THREE.Vector3();
		camera.getWorldDirection(dirBefore);
		const pitchBefore = Math.atan2(
			dirBefore.y,
			Math.hypot(dirBefore.x, dirBefore.z),
		);
		const yawBefore = Math.atan2(dirBefore.x, dirBefore.z);

		let maxPitchDelta = 0;
		let maxYawDelta = 0;
		let pitchRef = pitchBefore;
		let yawRef = yawBefore;
		let locked = false;
		for (let i = 0; i < 50; i++) {
			const pitch = Math.min(0.95, i * 0.02);
			quat.setFromEuler(new THREE.Euler(pitch, yaw0, 0, "YXZ"));
			car.y = 1 + Math.min(i, 25) * 0.05;
			const airVel = new THREE.Vector3(
				Math.sin(yaw0) * 10,
				5,
				Math.cos(yaw0) * 10,
			);
			airVel.addScaledVector(
				new THREE.Vector3(0, 0, 1).applyQuaternion(quat),
				8,
			);
			updateChaseCamera(
				camera,
				car,
				quat,
				ball,
				true,
				1 / 60,
				false,
				airVel.length(),
				state,
				BASE_FOV,
				Math.hypot(airVel.x, airVel.z),
				4,
				0,
				false,
				airVel,
				1,
				false,
			);
			const dir = new THREE.Vector3();
			camera.getWorldDirection(dir);
			const p = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
			const y = Math.atan2(dir.x, dir.z);
			if (!locked && state.airCamActive) {
				pitchRef = p;
				yawRef = y;
				locked = true;
				continue;
			}
			if (locked) {
				maxPitchDelta = Math.max(maxPitchDelta, Math.abs(p - pitchRef));
				maxYawDelta = Math.max(maxYawDelta, Math.abs(y - yawRef));
			}
		}

		expect(state.airCamActive).toBe(true);
		expect(locked).toBe(true);
		expect(maxPitchDelta).toBeLessThan(0.02);
		expect(maxYawDelta).toBeLessThan(0.02);
	});

	it("airborne lock działa mimo wheelsGrounded>0 (jak po realnym skoku)", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const car = new THREE.Vector3(0, 1.2, 0);
		const ball = new THREE.Vector3(0, 1, 35);
		const quat = new THREE.Quaternion();
		for (let i = 0; i < 30; i++) {
			updateChaseCamera(
				camera,
				car,
				quat,
				ball,
				true,
				1 / 60,
				false,
				10,
				state,
				BASE_FOV,
				10,
				4,
				0,
				false,
				new THREE.Vector3(0, 0, 10),
				1,
				true,
			);
		}
		const dir0 = new THREE.Vector3();
		camera.getWorldDirection(dir0);
		const pitch0 = Math.atan2(dir0.y, Math.hypot(dir0.x, dir0.z));

		for (let i = 0; i < 40; i++) {
			quat.setFromEuler(new THREE.Euler(Math.min(1.0, i * 0.03), 0, 0, "YXZ"));
			car.y = 1.2 + i * 0.04;
			updateChaseCamera(
				camera,
				car,
				quat,
				ball,
				true,
				1 / 60,
				false,
				14,
				state,
				BASE_FOV,
				12,
				3,
				0,
				false,
				new THREE.Vector3(0, 4, 12),
				1,
				false,
			);
		}
		const dir1 = new THREE.Vector3();
		camera.getWorldDirection(dir1);
		const pitch1 = Math.atan2(dir1.y, Math.hypot(dir1.x, dir1.z));
		expect(Math.abs(pitch1 - pitch0)).toBeLessThan(0.08);
		expect(state.framePan.y).toBeCloseTo(0, 5);
	});

	it("ball cam: trzymany kierunek podczas dodge nie zmienia yaw kamery", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const flatQuat = new THREE.Quaternion();
		const car = new THREE.Vector3(0, 1, 0);
		const ball = new THREE.Vector3(0, 1, 40);

		updateChaseCamera(
			camera,
			car,
			flatQuat,
			ball,
			true,
			1 / 60,
			false,
			10,
			state,
			BASE_FOV,
			10,
			4,
			0,
			false,
			new THREE.Vector3(0, 0, 12),
			1,
		);
		const fwdBefore = state.lastFlatForward.clone();
		const dirBefore = new THREE.Vector3();
		camera.getWorldDirection(dirBefore);

		const yawed = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(1.1, 0.85, 0.4, "YXZ"),
		);
		for (let i = 0; i < 20; i++) {
			updateChaseCamera(
				camera,
				car.clone().add(new THREE.Vector3(i * 0.05, 0.2, i * 0.08)),
				yawed,
				ball,
				true,
				1 / 60,
				false,
				28,
				state,
				BASE_FOV,
				28,
				0,
				0,
				true,
				new THREE.Vector3(8, 2, 18),
				1,
			);
		}

		expect(state.flipCamActive).toBe(true);
		expect(state.lastFlatForward.x).toBeCloseTo(fwdBefore.x, 4);
		expect(state.lastFlatForward.z).toBeCloseTo(fwdBefore.z, 4);
		const dirAfter = new THREE.Vector3();
		camera.getWorldDirection(dirAfter);
		const yawBefore = Math.atan2(dirBefore.x, dirBefore.z);
		const yawAfter = Math.atan2(dirAfter.x, dirAfter.z);
		expect(Math.abs(yawAfter - yawBefore)).toBeLessThan(0.12);
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
		camera.lookAt(0, 4.5, 0);
		state.smoothedLookAt.set(0, 4.5, 0);
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
		camera.position.set(0, 3.1, -6.5);
		/** Look mocno w bok → auto poza soft zone X. */
		camera.lookAt(6.5, 1.2, 0);
		state.smoothedLookAt.set(6.5, 1.2, 0);
		camera.updateMatrixWorld(true);

		const before = carPos.clone().project(camera);
		expect(Math.abs(before.x)).toBeGreaterThan(0.35);
		for (let i = 0; i < 90; i++) {
			applyPlayerScreenFraming(
				camera,
				carPos,
				state,
				1 / 60,
				RL_CAR.maxSpeed * 0.6,
			);
		}
		const after = carPos.clone().project(camera);
		expect(Math.abs(after.x)).toBeLessThan(Math.abs(before.x));
		expect(Math.abs(after.x)).toBeLessThan(0.5);
	});

	it("hard edge — auto prawie poza kadrem wraca szybko", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(88, 16 / 9, 0.1, 500);
		const carPos = new THREE.Vector3(0, 0.4, 0);
		camera.position.set(0, 3.2, -6.2);
		camera.lookAt(8, 1.0, 0);
		state.smoothedLookAt.set(8, 1.0, 0);
		camera.updateMatrixWorld(true);

		const before = carPos.clone().project(camera);
		expect(Math.abs(before.x)).toBeGreaterThan(0.55);
		for (let i = 0; i < 60; i++) {
			applyPlayerScreenFraming(camera, carPos, state, 1 / 60, 12);
		}
		const after = carPos.clone().project(camera);
		expect(Math.abs(after.x)).toBeLessThan(Math.abs(before.x) * 0.85);
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

	it("clampLookAtPitch przy prawie-nad-autem nie zostawia top-down", () => {
		const camPos = new THREE.Vector3(0, 8, 0);
		const lookAt = new THREE.Vector3(0.02, 0.2, 0.01);
		clampLookAtPitch(camPos, lookAt);
		const horiz = Math.hypot(lookAt.x - camPos.x, lookAt.z - camPos.z);
		expect(horiz).toBeGreaterThanOrEqual(0.34);
		const pitchDeg =
			(Math.atan2(lookAt.y - camPos.y, horiz) * 180) / Math.PI;
		expect(pitchDeg).toBeGreaterThanOrEqual(PLAYER_FRAME.maxPitchDownDeg - 0.1);
	});

	it("enforceMinCameraDistXZ wypycha kamerę z nad auta", () => {
		const camPos = new THREE.Vector3(0.2, 6, 0.1);
		const carPos = new THREE.Vector3(0, 0.3, 0);
		enforceMinCameraDistXZ(camPos, carPos, new THREE.Vector3(0, 0, -1));
		const distXZ = Math.hypot(camPos.x - carPos.x, camPos.z - carPos.z);
		expect(distXZ).toBeGreaterThanOrEqual(PLAYER_FRAME.minCamDistXZ - 0.01);
	});

	it("clampCameraInsideSoccar nie pozwala wyjść za linię bramkową / pod podłogę", () => {
		const pos = new THREE.Vector3(0, 0.1, 78);
		clampCameraInsideSoccar(pos, new THREE.Vector3(0, 0.4, 52));
		expect(pos.z).toBeLessThan(62);
		expect(pos.y).toBeGreaterThanOrEqual(0.7);
	});

	it("chase trzyma kamerę wyraźnie nad murawą (nie „lufa w trawę”)", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(86, 16 / 9, 0.1, 500);
		const carPos = new THREE.Vector3(0, 0.35, 0);
		const ballPos = new THREE.Vector3(20, 0.9, 8);
		const carQuat = new THREE.Quaternion();
		const vel = new THREE.Vector3(0, 0, 0);

		for (let i = 0; i < 90; i++) {
			updateChaseCamera(
				camera,
				carPos,
				carQuat,
				ballPos,
				true,
				1 / 60,
				false,
				0,
				state,
				undefined,
				0,
				0,
				0,
				false,
				vel,
			);
		}

		expect(camera.position.y).toBeGreaterThanOrEqual(1.0);
		const toLook = state.smoothedLookAt.clone().sub(camera.position);
		const horiz = Math.hypot(toLook.x, toLook.z);
		const pitchDeg = THREE.MathUtils.radToDeg(Math.atan2(toLook.y, horiz));
		expect(pitchDeg).toBeGreaterThan(-22);
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
		expect(maxJump).toBeLessThan(5.8);
		expect(isCarInCameraFrustum(camera, carPos, 0.15)).toBe(true);
	});
});

describe("kickoff chase framing", () => {
	it("kickoff diagonal spawn: auto blisko środka X (nie prawa połowa)", () => {
		const carPos = new THREE.Vector3(-20, 0.25, -30);
		const ballPos = new THREE.Vector3(0, 1, 0);
		const forward = new THREE.Vector3(0.55, 0, 0.83).normalize();
		const kick = sampleKickoffChaseCameraTargets(carPos, forward, ballPos);
		const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
		cam.position.copy(kick.targetPos);
		cam.up.set(0, 1, 0);
		cam.lookAt(kick.lookAt);
		cam.updateMatrixWorld(true);
		const ndc = carPos.clone().project(cam);
		expect(Math.abs(ndc.x)).toBeLessThan(0.12);
		expect(ndc.y).toBeGreaterThan(-0.7);
		expect(ndc.y).toBeLessThan(0.25);
		/** Kamera za autem, nie z boku. */
		const toCam = kick.targetPos.clone().sub(carPos);
		toCam.y = 0;
		toCam.normalize();
		expect(-toCam.dot(forward)).toBeGreaterThan(0.92);
	});

	it("kickoff lookAt zostaje blisko auta, nie w midfieldu", () => {
		const carPos = new THREE.Vector3(-20, 0.25, -30);
		const ballPos = new THREE.Vector3(0, 1, 0);
		const forward = new THREE.Vector3(0.707, 0, 0.707).normalize();
		const kick = sampleKickoffChaseCameraTargets(carPos, forward, ballPos);
		const mid = carPos.distanceTo(ballPos);
		const lookDist = carPos.distanceTo(kick.lookAt);
		expect(lookDist).toBeLessThan(6);
		expect(lookDist).toBeLessThan(mid * 0.25);

		const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
		cam.position.copy(kick.targetPos);
		cam.up.set(0, 1, 0);
		cam.lookAt(kick.lookAt);
		cam.updateMatrixWorld(true);
		const ndc = carPos.clone().project(cam);
		expect(Math.abs(ndc.x)).toBeLessThan(0.22);
		expect(ndc.y).toBeGreaterThan(-0.72);
		expect(ndc.y).toBeLessThan(0.2);
	});

	it("kickoff kamera siedzi za autem (forward), nie na ball-line z boku", () => {
		const carPos = new THREE.Vector3(-20, 0.25, -30);
		const ballPos = new THREE.Vector3(0, 1, 0);
		const forward = new THREE.Vector3(0.707, 0, 0.707).normalize();
		const kick = sampleKickoffChaseCameraTargets(carPos, forward, ballPos);
		const toCam = kick.targetPos.clone().sub(carPos);
		toCam.y = 0;
		toCam.normalize();
		const behindDot = -toCam.dot(forward);
		expect(behindDot).toBeGreaterThan(0.95);

		const lookFlat = kick.lookAt.clone().sub(carPos);
		lookFlat.y = 0;
		lookFlat.normalize();
		expect(lookFlat.dot(forward)).toBeGreaterThan(0.95);
	});

	it("countdown blend: look zostaje za autem, pozycja łagodnie do match", () => {
		const carPos = new THREE.Vector3(-20, 0.25, -30);
		const ballPos = new THREE.Vector3(0, 1, 0);
		const forward = new THREE.Vector3(0.707, 0, 0.707).normalize();
		const kick = sampleKickoffChaseCameraTargets(carPos, forward, ballPos);
		const match = sampleCountdownChaseCameraTargets(
			carPos,
			forward,
			ballPos,
			true,
			1,
		);
		const mid = sampleCountdownChaseCameraTargets(
			carPos,
			forward,
			ballPos,
			true,
			0.5,
		);
		/** Live match ≠ kickoff. */
		expect(kick.lookAt.distanceTo(match.lookAt)).toBeGreaterThan(0.45);
		/** Mid: look nadal kickoff (auto wyśrodkowane), nie ball-pull. */
		expect(mid.lookAt.distanceTo(kick.lookAt)).toBeLessThan(0.05);
		expect(mid.targetPos.distanceTo(kick.targetPos)).toBeGreaterThan(0.008);
	});

	it("ball cam przy ukosie kickoff trzyma auto blisko środka X", () => {
		const carPos = new THREE.Vector3(-20, 0.35, -30);
		const ballPos = new THREE.Vector3(0, 1, 0);
		const forward = new THREE.Vector3(0.707, 0, 0.707).normalize();
		const state = createChaseCameraState();
		state.lastFlatForward.copy(forward);
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const carQuat = new THREE.Quaternion().setFromUnitVectors(
			new THREE.Vector3(0, 0, 1),
			forward,
		);
		const vel = new THREE.Vector3(0, 0, 0);

		for (let i = 0; i < 90; i++) {
			updateChaseCamera(
				camera,
				carPos,
				carQuat,
				ballPos,
				true,
				1 / 60,
				false,
				0,
				state,
				undefined,
				0,
				0,
				0,
				false,
				vel,
				1,
			);
		}

		camera.updateMatrixWorld(true);
		const ndc = carPos.clone().project(camera);
		expect(Math.abs(ndc.x)).toBeLessThan(0.18);
		expect(ndc.y).toBeGreaterThan(-0.65);
		expect(ndc.y).toBeLessThan(0.2);
	});

	it("sampleChase przy postoju trzyma lookAt w limicie ballLookBlendMax", () => {
		const carPos = new THREE.Vector3(-20, 0.25, -30);
		const ballPos = new THREE.Vector3(0, 1, 0);
		const forward = new THREE.Vector3(0.55, 0, 0.83).normalize();
		const { lookAt } = sampleChaseCameraTargets(
			carPos,
			forward,
			ballPos,
			true,
		);
		const t =
			carPos.distanceTo(lookAt) /
			Math.max(1e-3, carPos.distanceTo(ballPos));
		/** Stały blend dystansowy — cap ballLookBlendMax. */
		expect(t).toBeLessThan(0.2);
		expect(t).toBeGreaterThan(0.02);
	});

	it("ball cam przy postoju nie topi lookAt w dach auta", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const carPos = new THREE.Vector3(0, 0.35, 0);
		const ballPos = new THREE.Vector3(25, 0.9, 0);
		const carQuat = new THREE.Quaternion();
		const vel = new THREE.Vector3(0, 0, 0);

		for (let i = 0; i < 45; i++) {
			updatePlayerTppCamera(
				camera,
				carPos,
				ballPos,
				carQuat,
				1 / 60,
				state,
				true,
				false,
				vel,
				false,
			);
		}

		const toLook = state.smoothedLookAt.clone().sub(camera.position);
		const horiz = Math.hypot(toLook.x, toLook.z);
		const pitchDeg = THREE.MathUtils.radToDeg(Math.atan2(toLook.y, horiz));
		/** Stojąc: pitch nie powinien być stromo w dół (dach / trawa). */
		expect(pitchDeg).toBeGreaterThan(-11);
		expect(state.smoothedLookAt.y).toBeGreaterThan(carPos.y + 0.75);
	});

	it("start z postoju (W) nie szarpie pitch/yaw lookAt", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(88, 16 / 9, 0.1, 500);
		const carPos = new THREE.Vector3(0, 0.35, 0);
		const ballPos = new THREE.Vector3(18, 0.9, 12);
		const carQuat = new THREE.Quaternion();
		const vel = new THREE.Vector3(0, 0, 0);

		for (let i = 0; i < 60; i++) {
			updateChaseCamera(
				camera,
				carPos,
				carQuat,
				ballPos,
				true,
				1 / 60,
				false,
				0,
				state,
				undefined,
				0,
				4,
				0,
				false,
				vel,
			);
		}

		const look0 = state.smoothedLookAt.clone();
		const cam0 = camera.position.clone();
		const dir0 = look0.clone().sub(cam0).normalize();

		/** Przyspieszenie z postoju — jak pierwsze klatki po W. */
		for (let i = 1; i <= 20; i++) {
			const spd = (i / 20) * RL_CAR.maxSpeed * 0.18;
			vel.set(0, 0, spd);
			carPos.z += spd * (1 / 60);
			updateChaseCamera(
				camera,
				carPos,
				carQuat,
				ballPos,
				true,
				1 / 60,
				false,
				spd,
				state,
				undefined,
				spd,
				4,
				0,
				false,
				vel,
			);
		}

		const dir1 = state.smoothedLookAt.clone().sub(camera.position).normalize();
		const angDeg = THREE.MathUtils.radToDeg(Math.acos(
			THREE.MathUtils.clamp(dir0.dot(dir1), -1, 1),
		));
		expect(angDeg).toBeLessThan(7.5);
		expect(Math.abs(state.smoothedLookAt.y - look0.y)).toBeLessThan(0.55);
	});
});
