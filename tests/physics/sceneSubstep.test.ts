import { describe, expect, it } from "vitest";

import Scene, { PHYSICS_FIXED_DT } from "../../src/Scene";

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
});
