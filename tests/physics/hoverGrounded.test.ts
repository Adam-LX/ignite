import { describe, expect, it, vi } from "vitest";

import RocketCar from "../../src/physics/RocketCar";
import { RL_HOVER } from "../../src/util/rlConstants";
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

describe("RocketCar — grounded hysteresis", () => {
	it("utrzymuje kontakt z ziemią przez grace po chwilowym skoku approach", () => {
		const scene = createTestScene();
		const car = createTestCar(scene);
		const input = new MockControlInput();
		simulateFrames(scene, car, input, 90);
		expect(car.isOnGround()).toBe(true);

		car.rapierRigidBody.setLinvel({ x: 0, y: -2.5, z: 0 }, true);
		const graceFrames = Math.ceil(RL_HOVER.groundReleaseGrace / (1 / 120));
		for (let i = 0; i < graceFrames; i++) {
			scene.advancePhysics(1 / 120, (dt, sub, count) => {
				car.integrateHover(dt, sub, count);
			});
		}
		expect(car.isOnGround()).toBe(true);
	});

	it("consumeLandingPulse bez lądowania zwraca 0", () => {
		const scene = createTestScene();
		const car = createTestCar(scene);
		const input = new MockControlInput();
		simulateFrames(scene, car, input, 30);
		expect(car.consumeLandingPulse()).toBe(0);
		expect(car.consumeLandingPulse()).toBe(0);
	});
});
