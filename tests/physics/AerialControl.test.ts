import { beforeEach, describe, expect, it, vi } from "vitest";

import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
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

function jumpToAir(scene: Scene, car: RocketCar, input: MockControlInput): void {
	car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
	simulateFrames(scene, car, input, 90);
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
	input.setJumpHeld(false);
	simulateFrames(scene, car, input, 8);
	expect(car.isOnGround()).toBe(false);
}

describe("RocketCar — aerial control (M2.5 P1)", () => {
	let scene: Scene;
	let car: RocketCar;
	let input: MockControlInput;

	beforeEach(() => {
		scene = createTestScene();
		car = createTestCar(scene);
		input = new MockControlInput();
	});

	it("boost w powietrzu przyspiesza bardziej niż bez boosta", () => {
		jumpToAir(scene, car, input);

		const speedNoBoost = car.getVelocity().length();
		simulateFrames(scene, car, input, 15);
		const gainNoBoost =
			car.getVelocity().length() - speedNoBoost;

		jumpToAir(scene, car, input);
		const speedWithBoost = car.getVelocity().length();
		input.setForward(1);
		input.setBoosting(true);
		simulateFrames(scene, car, input, 15);
		const gainWithBoost =
			car.getVelocity().length() - speedWithBoost;

		expect(gainWithBoost).toBeGreaterThan(gainNoBoost * 1.15);
	});

	it("yaw w powietrzu reaguje na stick (aerial control aktywny)", () => {
		jumpToAir(scene, car, input);
		const fwdBefore = car.getForward().clone();
		input.setYaw(1);
		simulateFrames(scene, car, input, 35);
		expect(car.isOnGround()).toBe(false);
		const turn = Math.abs(fwdBefore.angleTo(car.getForward()));
		expect(turn).toBeGreaterThan(0.08);
	});
});
