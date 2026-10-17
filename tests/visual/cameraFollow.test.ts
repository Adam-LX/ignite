import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	applyPlayerScreenFraming,
	applySpeedLeadToTarget,
	BASE_FOV,
	chaseSpeedStretchM,
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
	smoothFlatDirToward,
	tickBallCamBlendT,
	updateChaseCamera,
	updatePlayerTppCamera,
} from "../../src/visual/cameraFollow";
import { RL_CAMERA, RL_CAR } from "../../src/util/rlConstants";
import { RAMP_RUN } from "../../src/visual/perimeter/constants";
import { RL_ARENA } from "../../src/visual/arenaConstants";
import { isInsideGoalPocket } from "../../src/visual/goalPocket";

describe("cameraFollow FOV aspect", () => {
	it("chase height trzyma horyzont (nie top-down 1.48)", () => {
		expect(RL_CAMERA.height).toBeLessThanOrEqual(1.25);
		expect(RL_CAMERA.height).toBeGreaterThanOrEqual(0.9);
		expect(RL_CAMERA.angleDeg).toBeGreaterThanOrEqual(-5);
		expect(RL_CAMERA.angleDeg).toBeLessThanOrEqual(-3);
	});

	it("stiffness stretch rośnie z prędkością (Rocket Science feel)", () => {
		expect(chaseSpeedStretchM(0, 0.4)).toBe(0);
		expect(chaseSpeedStretchM(1, 1)).toBe(0);
		expect(chaseSpeedStretchM(1, 0)).toBeCloseTo(RL_CAMERA.maxSpeedStretch, 3);
		expect(chaseSpeedStretchM(1, 0.35)).toBeCloseTo(
			(1 - 0.35) * RL_CAMERA.maxSpeedStretch,
			3,
		);
	});

	it("RL pro: stiffness ~0.35, transitionSpeed ~1.3", () => {
		expect(RL_CAMERA.stiffness).toBeCloseTo(0.35, 2);
		expect(RL_CAMERA.transitionSpeed).toBeGreaterThanOrEqual(1.0);
		expect(RL_CAMERA.transitionSpeed).toBeLessThanOrEqual(1.6);
		expect(RL_CAMERA.swivelSpeed).toBeGreaterThanOrEqual(6.5);
		expect(RL_CAMERA.swivelSpeed).toBeLessThanOrEqual(7.5);
	});

	it("RL pro: FOV ~110, height ~0.9 m (majority 90 UU)", () => {
		expect(RL_CAMERA.horizontalFov).toBeCloseTo(110, 0);
		expect(RL_CAMERA.height).toBeCloseTo(0.9, 2);
	});

	it("tickBallCamBlendT dąży do celu bez skoku", () => {
		let t = 0;
		for (let i = 0; i < 90; i++) {
			t = tickBallCamBlendT(t, true, 1 / 60);
		}
		expect(t).toBeGreaterThan(0.85);
		expect(t).toBeLessThanOrEqual(1);
		const snap = tickBallCamBlendT(0.9999, true, 1 / 60);
		expect(snap).toBe(1);
	});

	it("trzyma vFOV jak @ 16:9 na ultrawide (bez fisheye +26°)", () => {
		const aspectUw = 3440 / 1440;
		const hUw = horizontalFovForAspect(RL_CAMERA.horizontalFov, aspectUw);
		const vUw = horizontalFovToVertical(hUw, aspectUw);
		const v169 = horizontalFovToVertical(
			RL_CAMERA.horizontalFov,
			16 / 9,
		);
		expect(Math.abs(vUw - v169)).toBeLessThan(0.05);
		/** Stary boost dawał ~127° — przy FOV 108 UW może dojść ~123°. */
		expect(hUw).toBeLessThan(125);
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
		 * Ball Cam: za autem na osi piłka→auto (ball @ +X → cam @ −X).
		 */
		expect(ball.x).toBeCloseTo(-5, 5);
		expect(Math.abs(ball.z)).toBeLessThan(0.01);
	});

	it("Free Cam looks ahead; Ball Cam looks at ball (środek kadru)", () => {
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
		/** Ball Cam: lookAt ≈ piłka. */
		expect(ball.x).toBeCloseTo(ballPos.x, 1);
		expect(ball.z).toBeCloseTo(ballPos.z, 1);
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

	it("Free Cam airborne + pitch (W/S) nie zmienia kąta patrzenia kamery", () => {
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
				false,
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
				false,
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

	it("Free Cam airborne lock działa mimo wheelsGrounded>0 (jak po realnym skoku)", () => {
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
				false,
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
				false,
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

	it("dodge nie stawia kamery za nosem gdy auto jest z ukosu (Ball Cam)", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const car = new THREE.Vector3(0, 1, 0);
		const ball = new THREE.Vector3(28, 1, 0);
		const quat = new THREE.Quaternion();
		const vel = new THREE.Vector3(0, 0, 8);

		for (let i = 0; i < 50; i++) {
			updateChaseCamera(
				camera,
				car,
				quat,
				ball,
				true,
				1 / 60,
				false,
				8,
				state,
				BASE_FOV,
				8,
				4,
				0,
				false,
				vel,
				1,
				true,
			);
		}

		expect(camera.position.x).toBeLessThan(-1.2);
		expect(Math.abs(camera.position.z)).toBeLessThan(1.4);
		const camX0 = camera.position.x;
		const yawed = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(1.2, 0.5, 0.8, "YXZ"),
		);
		for (let i = 0; i < 25; i++) {
			updateChaseCamera(
				camera,
				car,
				yawed,
				ball,
				true,
				1 / 60,
				false,
				16,
				state,
				BASE_FOV,
				10,
				0,
				0,
				true,
				new THREE.Vector3(2, 3, 6),
				1,
				false,
			);
		}

		expect(state.flipCamActive).toBe(true);
		/** Nadal z boku (oś piłka→auto), nie snap za +Z nosa. */
		expect(camera.position.x).toBeLessThan(-1.0);
		expect(Math.abs(camera.position.x - camX0)).toBeLessThan(1.2);
		expect(Math.abs(camera.position.z)).toBeLessThan(
			Math.abs(camera.position.x) * 0.85,
		);
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
		expect(pos.y).toBeGreaterThanOrEqual(1.3);
	});

	it("clampCameraInsideSoccar nie wchodzi w mesh rampy (pomarańczowa plama Free Cam)", () => {
		const pos = new THREE.Vector3(RL_ARENA.HALF_WIDTH - 0.5, 2.2, 10);
		clampCameraInsideSoccar(pos, new THREE.Vector3(20, 0.4, 10));
		expect(Math.abs(pos.x)).toBeLessThanOrEqual(
			RL_ARENA.HALF_WIDTH - RAMP_RUN - 1.0 + 0.05,
		);
	});

	it("clamp poza kieszenią nie wchodzi w rampę od strony bramki (Z)", () => {
		const pos = new THREE.Vector3(18, 1.5, RL_ARENA.HALF_LENGTH - 0.4);
		clampCameraInsideSoccar(pos, new THREE.Vector3(18, 0.4, 40));
		expect(Math.abs(pos.z)).toBeLessThanOrEqual(
			RL_ARENA.HALF_LENGTH - RAMP_RUN - 1.0 + 0.05,
		);
	});

	it("przy aucie w kieszeni kamera zostaje na boisku (nie wariuje w siatce)", () => {
		const halfLen = RL_ARENA.HALF_LENGTH;
		const carPos = new THREE.Vector3(0, 0.4, halfLen + 2.4);
		const pos = new THREE.Vector3(0, 0.3, halfLen + 4.5);
		clampCameraInsideSoccar(pos, carPos);
		expect(pos.z).toBeLessThanOrEqual(halfLen - 1.4);
		expect(pos.y).toBeGreaterThanOrEqual(2.2);

		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(86, 16 / 9, 0.1, 500);
		camera.position.set(0, 1.2, halfLen + 3);
		const ballPos = new THREE.Vector3(0, 0.9, halfLen + 1.5);
		const carQuat = new THREE.Quaternion();
		const vel = new THREE.Vector3(0, 0, 0);
		for (let i = 0; i < 120; i++) {
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
		expect(camera.position.z).toBeLessThan(halfLen - 3.5);
		expect(camera.position.y).toBeGreaterThanOrEqual(2.2);
		expect(isInsideGoalPocket(camera.position, 0.2)).toBe(false);
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

		expect(camera.position.y).toBeGreaterThanOrEqual(1.3);
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
		expect(ndc.y).toBeGreaterThan(-0.78);
		expect(ndc.y).toBeLessThan(0.2);
	});

	it("Ball Cam lookAt = piłka (środek kadru)", () => {
		const carPos = new THREE.Vector3(-20, 0.25, -30);
		const ballPos = new THREE.Vector3(0, 1, 0);
		const forward = new THREE.Vector3(0.55, 0, 0.83).normalize();
		const { lookAt } = sampleChaseCameraTargets(
			carPos,
			forward,
			ballPos,
			true,
		);
		expect(lookAt.x).toBeCloseTo(ballPos.x, 5);
		expect(lookAt.y).toBeCloseTo(ballPos.y, 5);
		expect(lookAt.z).toBeCloseTo(ballPos.z, 5);
	});

	it("Ball Cam przy postoju patrzy na piłkę (nie w dach auta)", () => {
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

		expect(state.smoothedLookAt.x).toBeCloseTo(ballPos.x, 0);
		expect(state.smoothedLookAt.z).toBeCloseTo(ballPos.z, 0);
		expect(Math.abs(state.smoothedLookAt.y - ballPos.y)).toBeLessThan(0.35);
		/** Auto u dołu kadru. */
		camera.updateMatrixWorld(true);
		const ndc = carPos.clone().project(camera);
		expect(ndc.y).toBeLessThan(-0.15);
		expect(Math.abs(ndc.x)).toBeLessThan(0.35);
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

	it("Ball Cam: gaz + skręt nie rwie pozycji kamery (orbit/dolly damp)", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const carPos = new THREE.Vector3(0, 0.35, -20);
		const ballPos = new THREE.Vector3(0, 0.9, 0);
		const carQuat = new THREE.Quaternion();
		const vel = new THREE.Vector3();
		const dt = 1 / 60;
		let yaw = 0;
		let spd = 0;

		for (let i = 0; i < 60; i++) {
			updateChaseCamera(
				camera,
				carPos,
				carQuat,
				ballPos,
				true,
				dt,
				false,
				0,
				state,
				undefined,
				0,
				4,
				0,
				false,
				vel,
				1,
				true,
			);
		}

		const prev = camera.position.clone();
		let maxPosDelta = 0;
		const accelTo = RL_CAR.maxSpeed * 0.65;
		for (let i = 0; i < 120; i++) {
			spd = Math.min(accelTo, spd + accelTo / 45);
			yaw += 1.8 * dt;
			carQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
			vel.set(Math.sin(yaw) * spd, 0, Math.cos(yaw) * spd);
			carPos.x += vel.x * dt;
			carPos.z += vel.z * dt;
			updateChaseCamera(
				camera,
				carPos,
				carQuat,
				ballPos,
				true,
				dt,
				false,
				spd,
				state,
				undefined,
				spd,
				4,
				0,
				false,
				vel,
				1,
				true,
			);
			maxPosDelta = Math.max(
				maxPosDelta,
				camera.position.distanceTo(prev),
			);
			prev.copy(camera.position);
		}
		/** Przed fixem ~1.45 m/f — regresja twardego dolly / orbit flip. */
		expect(maxPosDelta).toBeLessThan(0.55);
	});

	it("smoothFlatDirToward idzie najkrótszym łukiem bez przeskoku", () => {
		const cur = new THREE.Vector3(1, 0, 0);
		const des = new THREE.Vector3(0, 0, 1);
		for (let i = 0; i < 30; i++) {
			smoothFlatDirToward(cur, des, 1 / 60, 8, 4);
		}
		expect(cur.x).toBeLessThan(0.35);
		expect(cur.z).toBeGreaterThan(0.9);
		expect(Math.abs(cur.y)).toBeLessThan(1e-6);
	});

	it("wjazd na ścianę (pitch) nie odwraca heading 180°", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const car = new THREE.Vector3(0, 1, 40);
		const ball = new THREE.Vector3(0, 1, 20);
		const quat = new THREE.Quaternion();
		const vel = new THREE.Vector3(0, 0, 18);

		for (let i = 0; i < 20; i++) {
			updateChaseCamera(
				camera,
				car,
				quat,
				ball,
				false,
				1 / 60,
				false,
				18,
				state,
				BASE_FOV,
				18,
				4,
				0,
				false,
				vel,
				1,
				true,
			);
		}
		expect(state.lastFlatForward.z).toBeGreaterThan(0.85);

		for (let i = 1; i <= 40; i++) {
			const pitch = (i / 40) * 1.55;
			quat.setFromEuler(new THREE.Euler(pitch, 0, 0, "YXZ"));
			car.y = 1 + Math.sin(pitch) * 4;
			updateChaseCamera(
				camera,
				car,
				quat,
				ball,
				false,
				1 / 60,
				false,
				18,
				state,
				BASE_FOV,
				12,
				4,
				0,
				false,
				new THREE.Vector3(0, Math.sin(pitch) * 10, Math.cos(pitch) * 12),
				1,
				true,
				undefined,
				undefined,
				true,
			);
		}
		expect(state.lastFlatForward.z).toBeGreaterThan(0.7);
		expect(Math.abs(state.lastFlatForward.x)).toBeLessThan(0.35);
	});

	it("sideflip nie przechyla horyzontu (world-up)", () => {
		const state = createChaseCameraState();
		const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
		const car = new THREE.Vector3(0, 1, 0);
		const ball = new THREE.Vector3(0, 1, 30);
		const quat = new THREE.Quaternion();
		const vel = new THREE.Vector3(0, 2, 10);

		for (let i = 0; i < 15; i++) {
			updateChaseCamera(
				camera,
				car,
				quat,
				ball,
				false,
				1 / 60,
				false,
				10,
				state,
				BASE_FOV,
				10,
				4,
				0,
				false,
				vel,
				1,
				true,
			);
		}

		let maxRightY = 0;
		for (let i = 0; i < 50; i++) {
			quat.setFromEuler(new THREE.Euler(0, 0, (i / 50) * Math.PI * 2, "YXZ"));
			car.y = 1.1 + Math.sin((i / 50) * Math.PI) * 0.4;
			updateChaseCamera(
				camera,
				car,
				quat,
				ball,
				false,
				1 / 60,
				false,
				12,
				state,
				BASE_FOV,
				10,
				0,
				0,
				true,
				vel,
				1,
				false,
			);
			const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
				camera.quaternion,
			);
			maxRightY = Math.max(maxRightY, Math.abs(right.y));
			expect(state.flipCamActive).toBe(true);
		}
		expect(maxRightY).toBeLessThan(0.08);
	});
});

describe("chase look-back + wall heading", () => {
	it("lookBackT wymusza pose Free nawet przy Ball Cam blend=1", () => {
		const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
		const state = createChaseCameraState();
		const car = new THREE.Vector3(0, 0.3, 0);
		const ball = new THREE.Vector3(0, 1, 20);
		const quat = new THREE.Quaternion();
		const vel = new THREE.Vector3(0, 0, 12);

		for (let i = 0; i < 45; i++) {
			updatePlayerTppCamera(
				camera,
				car,
				ball,
				quat,
				1 / 60,
				state,
				true,
				false,
				vel,
				false,
				1,
				true,
				undefined,
				1,
				false,
				0,
			);
		}
		const ballCamLook = camera.getWorldDirection(new THREE.Vector3()).clone();

		for (let i = 0; i < 45; i++) {
			updatePlayerTppCamera(
				camera,
				car,
				ball,
				quat,
				1 / 60,
				state,
				true,
				false,
				vel,
				false,
				1,
				true,
				undefined,
				1,
				false,
				1,
			);
		}
		const lookBackDir = camera.getWorldDirection(new THREE.Vector3());
		expect(lookBackDir.dot(ballCamLook)).toBeLessThan(0.35);
	});

	it("onWallSurface nie wywraca orbitę przy forward XZ ≈ 0", () => {
		const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
		const state = createChaseCameraState();
		const car = new THREE.Vector3(40, 8, 0);
		const ball = new THREE.Vector3(20, 4, 0);
		/** Auto na ścianie: up = +X, forward = +Y (XZ forward ≈ 0). */
		const quat = new THREE.Quaternion().setFromUnitVectors(
			new THREE.Vector3(0, 1, 0),
			new THREE.Vector3(1, 0, 0),
		);
		const vel = new THREE.Vector3(0, 8, 0);

		for (let i = 0; i < 60; i++) {
			updatePlayerTppCamera(
				camera,
				car,
				ball,
				quat,
				1 / 60,
				state,
				false,
				false,
				vel,
				false,
				1,
				true,
				undefined,
				0,
				true,
				0,
			);
		}
		expect(Number.isFinite(camera.position.x)).toBe(true);
		expect(Number.isFinite(camera.position.y)).toBe(true);
		expect(camera.position.distanceTo(car)).toBeGreaterThan(1.5);
		expect(camera.position.distanceTo(car)).toBeLessThan(12);
	});
});
