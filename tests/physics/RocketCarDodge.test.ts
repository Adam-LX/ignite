import { beforeEach, describe, expect, it, vi } from "vitest";

import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
import { RL_CAR } from "../../src/util/rlConstants";
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

/** Skok z ziemi + frontflip po oknie jump hold. */
function jumpThenFlip(
	scene: Scene,
	car: RocketCar,
	input: MockControlInput,
): void {
	input.setForward(1);
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
	input.setJumpHeld(false);
	simulateFrames(scene, car, input, 14);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
}

describe("RocketCar — dodge / flip (RL)", () => {
	let scene: Scene;
	let car: RocketCar;
	let input: MockControlInput;

	beforeEach(() => {
		scene = createTestScene();
		car = createTestCar(scene);
		input = new MockControlInput();
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		simulateFrames(scene, car, input, 90);
		expect(car.isOnGround()).toBe(true);
	});

	it("frontflip dodaje ~500 uu/s (~5 m/s) poziomo", () => {
		jumpThenFlip(scene, car, input);
		const vel = car.getVelocity();
		const horiz = Math.hypot(vel.x, vel.z);
		expect(car.isFlipping()).toBe(true);
		expect(horiz).toBeGreaterThan(4.2);
		expect(horiz).toBeLessThan(8);
	});

	it("frontflip nie kasuje natychmiast prędkości w górę (pierwsze 0.15 s)", () => {
		jumpThenFlip(scene, car, input);
		expect(car.getVelocity().y).toBeGreaterThan(0.5);
	});

	it("bez WASD drugi skok to double jump w górę, nie flip", () => {
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 14);
		const vyBefore = car.getVelocity().y;
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(false);
		expect(car.getVelocity().y).toBeGreaterThan(vyBefore + 2);
	});
});
