import { describe, expect, it } from "vitest";

import Scene, { PHYSICS_FIXED_DT } from "../../src/Scene";
import { WORLD_GRAVITY } from "../../src/util/rlConstants";
import { createTestCar, createTestScene } from "./harness";

describe("Scene.advancePhysics — sub-stepping", () => {
	it("eksportuje PHYSICS_FIXED_DT @ 120 Hz", () => {
		expect(PHYSICS_FIXED_DT).toBeCloseTo(1 / 120, 6);
	});

	it("2 sub-kroki @ 60 Hz gdy jest preStep (auto)", () => {
		const scene = new Scene();
		let calls = 0;
		const result = scene.advancePhysics(1 / 60, () => {
			calls++;
		});
		expect(result.steps).toBe(2);
		expect(result.fixedDt).toBeCloseTo(1 / 120, 5);
		expect(calls).toBe(2);
	});

	it("1 krok @ frameDt bez preStep (piłka)", () => {
		const scene = new Scene();
		const result = scene.advancePhysics(1 / 60);
		expect(result.steps).toBe(1);
		expect(result.fixedDt).toBeCloseTo(1 / 60, 5);
	});

	it("siły z preStep nie kumulują się między substepami (anty-g)", () => {
		const scene = createTestScene();
		const car = createTestCar(scene);
		const body = car.rapierRigidBody;
		body.setTranslation({ x: 0, y: 8, z: 0 }, true);
		body.setLinvel({ x: 0, y: 0, z: 0 }, true);
		body.setAngvel({ x: 0, y: 0, z: 0 }, true);
		body.setLinearDamping(0);
		body.setAngularDamping(0);

		const mass = body.mass();
		const lift = mass * Math.abs(WORLD_GRAVITY);

		for (let f = 0; f < 45; f++) {
			scene.advancePhysics(1 / 60, () => {
				body.addForce({ x: 0, y: lift, z: 0 }, true);
			});
		}

		/** Bez resetu per substep: 2× lift vs 1× g → rakieta w górę. */
		expect(Math.abs(body.linvel().y)).toBeLessThan(1.2);
		expect(body.translation().y).toBeGreaterThan(6.5);
		expect(body.translation().y).toBeLessThan(9.5);
	});
});
