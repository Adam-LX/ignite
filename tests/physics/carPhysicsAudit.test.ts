import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
import {
	createTestCar,
	createTestScene,
	FRAME_DT,
	localPitchRate,
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

function jumpThenFrontflip(
	scene: Scene,
	car: RocketCar,
	input: MockControlInput,
	opts: { holdW?: boolean; yawAt2?: number; speedZ?: number } = {},
): void {
	car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: opts.speedZ ?? 0 }, true);

	input.setForward(1);
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
	input.setJumpHeld(false);
	if (!opts.holdW) input.setForward(0);
	input.setYaw(0);
	simulateFrames(scene, car, input, 14);

	input.setForward(opts.holdW ? 1 : 0);
	if (opts.yawAt2 !== undefined) input.setYaw(opts.yawAt2);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
}

function maxAbsVxDuringFlip(
	scene: Scene,
	car: RocketCar,
	input: MockControlInput,
	frames: number,
): number {
	let maxAbsVx = 0;
	for (let i = 0; i < frames; i++) {
		simulateFrames(scene, car, input, 1);
		maxAbsVx = Math.max(maxAbsVx, Math.abs(car.getVelocity().x));
	}
	return maxAbsVx;
}

function eulerFromCar(car: RocketCar): THREE.Euler {
	const rot = car.rapierRigidBody.rotation();
	const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
	return new THREE.Euler().setFromQuaternion(q, "YXZ");
}

describe("car physics audit — regresja dodge / second jump", () => {
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

	it("frontflip W-only — brak bocznego dryfu (max |vx| < 0.2)", () => {
		jumpThenFrontflip(scene, car, input, { holdW: true });
		expect(car.isFlipping()).toBe(true);
		expect(maxAbsVxDuringFlip(scene, car, input, 25)).toBeLessThan(0.2);
	});

	it("frontflip W + ghost yaw 0.15 — brak bocznego dryfu", () => {
		jumpThenFrontflip(scene, car, input, { holdW: true, yawAt2: 0.15 });
		expect(car.isFlipping()).toBe(true);
		expect(maxAbsVxDuringFlip(scene, car, input, 25)).toBeLessThan(0.2);
	});

	it("frontflip @ 12 m/s — brak bocznego dryfu", () => {
		jumpThenFrontflip(scene, car, input, { holdW: true, speedZ: 12 });
		expect(maxAbsVxDuringFlip(scene, car, input, 25)).toBeLessThan(0.35);
	});

	it("neutral 2nd jump — pitch/roll nie narastają", () => {
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 14);
		input.queueJump();
		simulateFrames(scene, car, input, 1);

		let maxPitchAbs = 0;
		let maxRollAbs = 0;
		for (let i = 0; i < 20; i++) {
			simulateFrames(scene, car, input, 1);
			const av = car.rapierRigidBody.angvel();
			maxPitchAbs = Math.max(maxPitchAbs, Math.abs(av.x));
			maxRollAbs = Math.max(maxRollAbs, Math.abs(av.z));
		}
		expect(maxPitchAbs).toBeLessThan(0.25);
		expect(maxRollAbs).toBeLessThan(0.25);
	});

	it("low-speed neutral 2nd jump — orientacja stabilna (< 8° pitch/roll)", () => {
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 14);
		input.queueJump();
		simulateFrames(scene, car, input, 1);

		let maxPitchDeg = 0;
		let maxRollDeg = 0;
		for (let i = 0; i < 30; i++) {
			simulateFrames(scene, car, input, 1);
			const e = eulerFromCar(car);
			maxPitchDeg = Math.max(maxPitchDeg, Math.abs((e.x * 180) / Math.PI));
			maxRollDeg = Math.max(maxRollDeg, Math.abs((e.z * 180) / Math.PI));
		}
		expect(maxPitchDeg).toBeLessThan(8);
		expect(maxRollDeg).toBeLessThan(8);
	});

	it("backflip vs frontflip — przeciwny znak pitch rate", () => {
		jumpThenFrontflip(scene, car, input, { holdW: true });
		simulateFrames(scene, car, input, 3);
		const frontPitch = localPitchRate(car);
		expect(Math.abs(frontPitch)).toBeGreaterThan(0.5);

		scene = createTestScene();
		car = createTestCar(scene);
		input = new MockControlInput();
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		simulateFrames(scene, car, input, 90);

		input.setForward(-1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setForward(-1);
		simulateFrames(scene, car, input, 14);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		simulateFrames(scene, car, input, 3);

		expect(Math.sign(localPitchRate(car))).toBe(-Math.sign(frontPitch));
	});

	it("hover stabilny — prędkość pionowa < 0.5 po 2 s", () => {
		scene = createTestScene();
		car = createTestCar(scene);
		input = new MockControlInput();
		car.rapierRigidBody.setTranslation({ x: 0, y: 5, z: 0 }, true);
		simulateFrames(scene, car, input, 120);
		expect(car.isOnGround()).toBe(true);
		expect(Math.abs(car.getVelocity().y)).toBeLessThan(0.5);
	});

	it("throttle — przyspieszenie do > 1 m/s w 1 s", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 60);
		const fwd = car.getForward().normalize();
		const speed = car.getVelocity().dot(fwd);
		expect(speed).toBeGreaterThan(1);
	});
});
