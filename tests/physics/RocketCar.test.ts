import { beforeEach, describe, expect, it, vi } from "vitest";

import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
import { RL_CAR } from "../../src/util/rlConstants";
import {
	createTestCar,
	createTestScene,
	expectedHoverCenterY,
	GROUND_HALF_Y,
	localForwardSpeed,
	localPitchRate,
	MockControlInput,
	simulateFrames,
} from "./harness";

vi.mock("../../src/debug/config", () => ({
	HOVER_SAFE_MODE: true,
	HOVER_DEBUG_RAYS: false,
	HOVER_FORCE_MAX: 50_000,
	HOVER_TELEMETRY_EVERY_STEPS: 0,
	DEBUG_AUTOPILOT: false,
	AUTOPILOT_DURATION_SEC: 20,
}));

describe("RocketCar — headless physics", () => {
	let scene: Scene;
	let car: RocketCar;
	let input: MockControlInput;

	beforeEach(() => {
		scene = createTestScene();
		car = createTestCar(scene);
		input = new MockControlInput();
	});

	describe("Test 1: Grawitacja i lewitacja (hover suspension)", () => {
		it("stabilizuje auto nad podłogą bez przebicia i ustawia isGrounded", () => {
			car.rapierRigidBody.setTranslation({ x: 0, y: 5, z: 0 }, true);
			car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);

			simulateFrames(scene, car, input, 120);

			const y = car.getPosition().y;
			const vy = car.getVelocity().y;
			const expectedY = expectedHoverCenterY();
			const minBodyY = GROUND_HALF_Y + RL_CAR.hitboxHalfY * 0.5;

			expect(y).toBeGreaterThan(minBodyY);
			expect(y).toBeCloseTo(expectedY, 0);
			expect(Math.abs(vy)).toBeLessThan(0.5);
			expect(car.isOnGround()).toBe(true);
		});
	});

	describe("Test 2: Mechanika skoku (liftoff & jump impulse)", () => {
		it("nadaje pionowy impuls i traci kontakt z podłożem", () => {
			car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
			car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);

			simulateFrames(scene, car, input, 90);
			expect(car.isOnGround()).toBe(true);

			input.queueJump();
			simulateFrames(scene, car, input, 1);

			const vyAfterJump = car.rapierRigidBody.linvel().y;
			expect(vyAfterJump).toBeGreaterThan(2.5);

			simulateFrames(scene, car, input, 8);
			expect(car.isOnGround()).toBe(false);
		});
	});

	describe("Test 3: Aerodynamika i aerial control (pitch / roll)", () => {
		it("obraca nosem w dół na W i tłumi rotację po puszczeniu (stójka)", () => {
			car.rapierRigidBody.setTranslation({ x: 0, y: 20, z: 0 }, true);
			car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
			car.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

			input.setForward(1);
			simulateFrames(scene, car, input, 10);

			const pitchDuringInput = Math.abs(localPitchRate(car));
			expect(pitchDuringInput).toBeGreaterThan(0.05);

			input.setForward(0);
			simulateFrames(scene, car, input, 20);

			const pitchAfterRelease = Math.abs(localPitchRate(car));
			expect(pitchAfterRelease).toBeLessThan(pitchDuringInput * 0.15);
			expect(pitchAfterRelease).toBeLessThan(0.25);
		});
	});

	describe("Test 4: Jazda do przodu (throttle)", () => {
		it("przyspiesza wzdłuż lokalnej osi Z do limitu Vmax", () => {
			car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
			car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);

			simulateFrames(scene, car, input, 60);
			expect(car.isOnGround()).toBe(true);

			input.setForward(1);
			simulateFrames(scene, car, input, 60);

			const fwdSpeed = localForwardSpeed(car);
			expect(fwdSpeed).toBeGreaterThan(1.0);
			expect(fwdSpeed).toBeLessThanOrEqual(RL_CAR.maxSpeed + 0.5);
		});
	});
});
