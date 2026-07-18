import { describe, expect, it, vi } from "vitest";

import RocketCar from "../../src/physics/RocketCar";
import { RL_CAR } from "../../src/util/rlConstants";
import {
	createTestCar,
	createTestScene,
	createWallTestScene,
	expectedHoverCenterY,
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

describe("Physics regression — M2.5 smoke", () => {
	it("hover stabilny na płaskiej podłodze", () => {
		const scene = createTestScene();
		const car = createTestCar(scene);
		const input = new MockControlInput();
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		simulateFrames(scene, car, input, 120);
		expect(car.isOnGround()).toBe(true);
		expect(Math.abs(car.getPosition().y - expectedHoverCenterY())).toBeLessThan(
			0.35,
		);
	});

	it("frontflip zachowuje ≥85% prędkości poziomej pre-flip", () => {
		const scene = createTestScene();
		const car = createTestCar(scene);
		const input = new MockControlInput();
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 14 }, true);
		simulateFrames(scene, car, input, 90);

		const preHoriz = Math.hypot(
			car.getVelocity().x,
			car.getVelocity().z,
		);

		input.setForward(1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 14);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		simulateFrames(scene, car, input, 30);

		const postHoriz = Math.hypot(
			car.getVelocity().x,
			car.getVelocity().z,
		);
		expect(postHoriz).toBeGreaterThan(preHoriz * 0.85);
	});

	it("ściana — stałe wall ride w rlConstants", () => {
		expect(RL_CAR.wallRideSeparationMax).toBeGreaterThan(0);
		expect(RL_CAR.flipImpulseSpreadTicks).toBeGreaterThan(1);
		expect(RL_CAR.airBoostLinearDampMul).toBeLessThan(1);
	});

	it("wjazd w ścianę nie przekracza 10 m wysokości", () => {
		const scene = createWallTestScene();
		const car = createTestCar(scene);
		const input = new MockControlInput();
		car.resetKickoffPose(3, expectedHoverCenterY(), 0, Math.PI / 2);
		car.rapierRigidBody.setLinvel({ x: 20, y: 0, z: 0 }, true);
		input.setForward(1);
		input.setBoosting(true);

		let maxY = 0;
		simulateFrames(scene, car, input, 120);
		for (let i = 0; i < 120; i++) {
			maxY = Math.max(maxY, car.getPosition().y);
		}
		expect(maxY).toBeLessThan(10);
	});
});
