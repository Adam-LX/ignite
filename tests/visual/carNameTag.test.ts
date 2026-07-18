import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	CAR_NAME_TAG_REF_DISTANCE,
	CAR_NAME_TAG_SCALE_MAX,
	CAR_NAME_TAG_SCALE_MIN,
	carNameTagScaleFromDistance,
	computeCarNameTagAnchor,
} from "../../src/visual/CarNameTag";

describe("carNameTagScaleFromDistance", () => {
	it("returns 1 at reference distance", () => {
		expect(carNameTagScaleFromDistance(CAR_NAME_TAG_REF_DISTANCE)).toBe(1);
	});

	it("scales inversely with distance within clamp band", () => {
		expect(carNameTagScaleFromDistance(16)).toBeCloseTo(15 / 16, 5);
		expect(carNameTagScaleFromDistance(40)).toBe(CAR_NAME_TAG_SCALE_MIN);
	});

	it("grows when camera is closer", () => {
		expect(carNameTagScaleFromDistance(12)).toBeGreaterThan(1);
	});

	it("shrinks when camera is farther", () => {
		expect(carNameTagScaleFromDistance(48)).toBeLessThan(1);
	});

	it("clamps extreme distances", () => {
		expect(carNameTagScaleFromDistance(2)).toBe(CAR_NAME_TAG_SCALE_MAX);
		expect(carNameTagScaleFromDistance(200)).toBe(CAR_NAME_TAG_SCALE_MIN);
	});
});

describe("computeCarNameTagAnchor", () => {
	it("uses body mesh, not headlight beams on visualRoot", () => {
		const root = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 3));
		body.name = "body";
		body.position.set(0, 0.5, 0);
		root.add(body);

		const beam = new THREE.Mesh(
			new THREE.CylinderGeometry(0.12, 3.2, 24, 10, 1, true),
		);
		beam.name = "headlightBeam_L";
		beam.position.set(0, 0.3, 12);
		root.add(beam);

		const box = new THREE.Box3();
		computeCarNameTagAnchor(root, box);

		expect(box.max.y).toBeCloseTo(1, 4);
		expect(box.max.z).toBeLessThan(2);
	});

	it("falls back to car shell when body is missing", () => {
		const root = new THREE.Group();
		const shell = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 2.8));
		shell.position.set(0, 0.45, 0);
		root.add(shell);

		const beam = new THREE.Mesh(
			new THREE.CylinderGeometry(0.12, 3.2, 24, 10, 1, true),
		);
		beam.name = "headlightBeam_R";
		root.add(beam);

		const box = new THREE.Box3();
		computeCarNameTagAnchor(root, box);

		expect(box.max.y).toBeCloseTo(0.9, 4);
	});
});
