import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
import { RL_BALL, RL_CAR } from "../../src/util/rlConstants";
import { PLAYFIELD_SURFACE_Y } from "../../src/visual/arenaConstants";
import {
	createTestCar,
	createTestScene,
	MockControlInput,
	simulateFrames,
} from "./harness";

vi.mock("../../src/debug/config", () => ({
	HOVER_SAFE_MODE: false,
	HOVER_DEBUG_RAYS: false,
	HOVER_FORCE_MAX: 50_000,
	HOVER_TELEMETRY_EVERY_STEPS: 0,
	DEBUG_AUTOPILOT: false,
	AUTOPILOT_DURATION_SEC: 20,
}));

describe("flip reset + wavedash (RL clean-room)", () => {
	let scene: Scene;
	let car: RocketCar;
	let input: MockControlInput;

	beforeEach(async () => {
		scene = await createTestScene();
		car = createTestCar(scene);
		input = new MockControlInput();
	});

	it("tryFlipResetFromBall restores dodge after used aerial", () => {
		car.applyDevSpawnPose({
			x: 0,
			y: 8,
			z: 0,
			yawY: 0,
			jumpCount: 2,
			grounded: false,
			vel: { x: 0, y: 0, z: 0 },
		});
		expect(car["canSecondJump"]).toBe(false);

		const ballPos = new THREE.Vector3(
			0,
			8 - (RL_BALL.radius + RL_CAR.hitboxHalfY * 0.5),
			0,
		);
		let ok = false;
		for (let i = 0; i < 8; i++) {
			ok = car.tryFlipResetFromBall(ballPos, 1 / 60) || ok;
		}
		expect(ok).toBe(true);
		expect(car["canSecondJump"]).toBe(true);
		expect(car["jumpCount"]).toBe(1);
		expect(car.consumeFlipResetPulse()).toBe(true);
		expect(car.consumeFlipResetPulse()).toBe(false);
	});

	it("flip reset ignores when dodge still available", () => {
		car.applyDevSpawnPose({
			x: 0,
			y: 8,
			z: 0,
			yawY: 0,
			jumpCount: 1,
			grounded: false,
		});
		const ballPos = new THREE.Vector3(0, 8 - RL_BALL.radius, 0);
		for (let i = 0; i < 10; i++) {
			expect(car.tryFlipResetFromBall(ballPos, 1 / 60)).toBe(false);
		}
		expect(car.consumeFlipResetPulse()).toBe(false);
	});

	it("wavedash cancel on early flip land boosts horizontal speed", () => {
		car.applyDevSpawnPose({
			x: 0,
			y: PLAYFIELD_SURFACE_Y + 1.1,
			z: 0,
			yawY: 0,
			jumpCount: 1,
			grounded: false,
			vel: { x: 0, y: -4, z: 8 },
		});
		input.setForward(1);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		/** Force flip state mid-air near turf. */
		car["flipActive"] = true;
		car["flipElapsed"] = 0.1;
		car["flipTimer"] = 0.4;
		car["flipRelY"] = -1;
		car["wheelsCompressing"] = 3;
		car["wheelsGrounded"] = 3;
		const before = car.getVelocity().length();
		car["tryWaveDashOnFlipLand"]();
		expect(car.isFlipping()).toBe(false);
		const after = car.getVelocity().clone();
		expect(after.length()).toBeGreaterThan(before * 0.9);
		expect(Math.abs(after.z) + Math.abs(after.x)).toBeGreaterThan(6);
	});
});
