import { beforeEach, describe, expect, it, vi } from "vitest";

import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
import { RL_CAR } from "../../src/util/rlConstants";
import {
	createRampTestScene,
	createTestCar,
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

function driveIntoWall(
	scene: Scene,
	car: RocketCar,
	input: MockControlInput,
	startX: number,
	speedMps: number,
	frames: number,
): { maxY: number; hitWall: boolean; maxSepVel: number } {
	car.resetKickoffPose(startX, expectedHoverCenterY(), 0, Math.PI / 2);
	car.rapierRigidBody.setLinvel({ x: speedMps, y: 0, z: 0 }, true);
	simulateFrames(scene, car, input, 30);

	input.setForward(1);
	input.setBoosting(true);

	let maxY = car.getPosition().y;
	let hitWall = false;
	let maxSepVel = 0;

	for (let i = 0; i < frames; i++) {
		car.control(input, 1 / 60);
		scene.advancePhysics(
			1 / 60,
			(dt, substep, substepCount) =>
				car.integrateHover(dt, substep, substepCount),
			(_dt, substep, substepCount) =>
				car.finalizeHoverStep(substep, substepCount),
		);
		car.afterPhysics(1 / 60);

		const pos = car.getPosition();
		maxY = Math.max(maxY, pos.y);
		if (car.isOnWallOrRamp()) {
			hitWall = true;
			const n = car.getSurfaceNormal();
			const vn = car.getVelocity().dot(n);
			maxSepVel = Math.max(maxSepVel, vn);
		}
	}

	return { maxY, hitWall, maxSepVel };
}

describe("RocketCar — wall ride (M2.5 P0)", () => {
	let scene: Scene;
	let car: RocketCar;
	let input: MockControlInput;

	beforeEach(() => {
		scene = createWallTestScene();
		car = createTestCar(scene);
		input = new MockControlInput();
	});

	it("wjazd 20 m/s w ścianę — wall-ride (wspinaczka, bez odlotu ponad bandę)", () => {
		const { maxY, hitWall } = driveIntoWall(scene, car, input, 3, 20, 120);
		expect(hitWall).toBe(true);
		/** Ściana testowa sięga y≈16 — climb OK, launch w kosmos nie. */
		expect(maxY).toBeGreaterThan(2.5);
		expect(maxY).toBeLessThan(20);
	});

	it("na ścianie |v·n| oddalające od powierzchni ≤ wallRideSeparationMax + margines", () => {
		const { hitWall, maxSepVel } = driveIntoWall(scene, car, input, 3, 18, 150);
		expect(hitWall).toBe(true);
		expect(maxSepVel).toBeLessThan(RL_CAR.wallRideSeparationMax + 1.5);
	});

	it("rampa 45° — auto utrzymuje kontakt (nie odlatuje powyżej 7 m)", () => {
		scene = createRampTestScene();
		car = createTestCar(scene);
		const { maxY } = driveIntoWall(scene, car, input, 2, 16, 120);
		expect(maxY).toBeLessThan(7);
	});
});
