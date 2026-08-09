import { describe, expect, it } from "vitest";

import {
	CAR_VISUAL_SCALE,
	OCTANE_LENGTH,
	OCTANE_VISUAL_WIDTH,
} from "../../src/visual/octaneCarMesh";

/** Lustrzane computeMeshyVisualScale z CarModel.ts — test bez WebGL. */
function computeMeshyVisualScale(size: { x: number; z: number }): number {
	const scaleX = OCTANE_VISUAL_WIDTH / size.x;
	const scaleZ = OCTANE_LENGTH / size.z;
	const fit = Math.min(scaleX, scaleZ);
	const widthLimited = scaleX <= scaleZ;
	return fit * (widthLimited ? 1 : CAR_VISUAL_SCALE);
}

describe("computeMeshyVisualScale", () => {
	it("octane — długość limituje, CAR_VISUAL_SCALE aktywny", () => {
		const s = computeMeshyVisualScale({ x: 0.582, z: 1.18 });
		expect(s).toBeCloseTo(CAR_VISUAL_SCALE, 3);
	});

	it("muscle — szerokość limituje, bez puchnięcia 1.42×", () => {
		const s = computeMeshyVisualScale({ x: 0.82, z: 1.18 });
		expect(s).toBeCloseTo(OCTANE_VISUAL_WIDTH / 0.82, 3);
		expect(s).toBeLessThan(1);
	});

	it("po skali muscle mieści się w OCTANE_VISUAL_WIDTH", () => {
		const w = 0.82;
		const s = computeMeshyVisualScale({ x: w, z: 1.18 });
		expect(w * s).toBeCloseTo(OCTANE_VISUAL_WIDTH, 2);
	});
});
