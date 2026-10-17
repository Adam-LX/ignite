import { describe, expect, it, beforeEach, vi } from "vitest";
import * as THREE from "three";
import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
import {
	createTestCar,
	createTestScene,
	MockControlInput,
	simulateFrames,
	localPitchRate,
	localRollRate,
} from "./harness";

vi.mock("../../src/debug/config", () => ({
	HOVER_SAFE_MODE: false,
	HOVER_DEBUG_RAYS: false,
	HOVER_FORCE_MAX: 50_000,
	HOVER_TELEMETRY_EVERY_STEPS: 0,
	DEBUG_AUTOPILOT: false,
	AUTOPILOT_DURATION_SEC: 20,
}));

function startFlip(
	scene: Scene,
	car: RocketCar,
	input: MockControlInput,
	dir: { forward?: number; yaw?: number },
): void {
	const fwd = dir.forward ?? 0;
	const yaw = dir.yaw ?? 0;
	if (fwd) input.setForward(fwd);
	if (yaw) input.setYaw(yaw);
	simulateFrames(scene, car, input, 20);
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
	input.setJumpHeld(false);
	input.setForward(0);
	input.setYaw(0);
	simulateFrames(scene, car, input, 16);
	if (fwd) input.setForward(fwd);
	if (yaw) input.setYaw(yaw);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
}

describe("RocketCar — dodge plane constraint (RL 1:1)", () => {
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

	it("frontflip: up zostaje w płaszczyźnie pitch (bez corkscrew)", () => {
		startFlip(scene, car, input, { forward: 1 });
		expect(car.isFlipping()).toBe(true);

		/** Oś pitch ≈ prawo w poziomie na starcie — up·right ≈ 0 przez cały flip. */
		const right0 = car.getSideward().clone();
		right0.y = 0;
		right0.normalize();

		input.setForward(1);
		let maxAbsRoll = 0;
		let maxPlaneErr = 0;
		let sawNoseDown = false;
		for (let i = 0; i < 40; i++) {
			simulateFrames(scene, car, input, 1);
			if (!car.isFlipping()) break;
			maxAbsRoll = Math.max(maxAbsRoll, Math.abs(localRollRate(car)));
			const up = car.getUpward();
			maxPlaneErr = Math.max(maxPlaneErr, Math.abs(up.dot(right0)));
			if (car.getForward().y < -0.5) sawNoseDown = true;
		}
		expect(sawNoseDown).toBe(true);
		expect(maxAbsRoll).toBeLessThan(0.08);
		expect(maxPlaneErr).toBeLessThan(0.05);
	});

	it("sideflip: up zostaje w płaszczyźnie roll", () => {
		startFlip(scene, car, input, { yaw: 1 });
		expect(car.isFlipping()).toBe(true);

		const fwd0 = car.getForward().clone();
		fwd0.y = 0;
		fwd0.normalize();

		input.setYaw(1);
		let maxAbsPitch = 0;
		let maxPlaneErr = 0;
		let sawSide = false;
		for (let i = 0; i < 40; i++) {
			simulateFrames(scene, car, input, 1);
			if (!car.isFlipping()) break;
			maxAbsPitch = Math.max(maxAbsPitch, Math.abs(localPitchRate(car)));
			const up = car.getUpward();
			maxPlaneErr = Math.max(maxPlaneErr, Math.abs(up.dot(fwd0)));
			if (Math.abs(up.x) > 0.55 || Math.abs(up.z) > 0.55) sawSide = true;
		}
		expect(sawSide).toBe(true);
		expect(maxAbsPitch).toBeLessThan(0.08);
		expect(maxPlaneErr).toBeLessThan(0.05);
	});
});
