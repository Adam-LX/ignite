import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/visual/meridianArena", () => {
	const center = new THREE.Vector3(0, 50, 0);
	return {
		isMeridianArenaActive: () => true,
		getMeridianSphere: () => ({ center, radius: 50 }),
	};
});

import {
	clampPointInsideMeridian,
	computeMeridianCamLookAt,
	computeMeridianCamTarget,
} from "../../src/visual/meridianCamera";

describe("meridianCamera", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("trzyma kamerę wewnątrz sfery (nie pod skorupą)", () => {
		const car = new THREE.Vector3(0, 2, 0);
		const ball = new THREE.Vector3(0, 40, 0);
		const forward = new THREE.Vector3(0, 0, 1);
		const out = new THREE.Vector3();
		computeMeridianCamTarget(car, ball, forward, true, out);
		const dist = out.distanceTo(new THREE.Vector3(0, 50, 0));
		expect(dist).toBeLessThan(50 - 3);
	});

	it("lookAt idzie przez auto w stronę piłki (auto w centrum)", () => {
		const car = new THREE.Vector3(0, 5, -10);
		const ball = new THREE.Vector3(20, 30, 15);
		const forward = new THREE.Vector3(0, 0, 1);
		const look = new THREE.Vector3();
		computeMeridianCamLookAt(car, ball, forward, true, look);
		const toLook = look.clone().sub(car).normalize();
		const toBall = ball.clone().sub(car).normalize();
		expect(toLook.dot(toBall)).toBeGreaterThan(0.98);
	});

	it("clampPointInsideMeridian nie wypuszcza poza clearance", () => {
		const p = new THREE.Vector3(0, -10, 0);
		clampPointInsideMeridian(p, 3.4);
		const dist = p.distanceTo(new THREE.Vector3(0, 50, 0));
		expect(dist).toBeLessThanOrEqual(50 - 3.4 + 1e-4);
	});
});
