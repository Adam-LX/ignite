import { describe, expect, it } from "vitest";
import {
	ballOffScreenEdgeNdc,
	BALL_OFFSCREEN_EDGE_MARGIN,
} from "../../src/ui/BallOffScreenIndicator";

describe("ballOffScreenEdgeNdc", () => {
	it("zwraca null gdy piłka w kadrze", () => {
		expect(ballOffScreenEdgeNdc(0.1, -0.2, 0.5)).toBeNull();
	});

	it("clampuje do krawędzi gdy poza FOV", () => {
		const e = ballOffScreenEdgeNdc(2.5, 0.1, 0.4);
		expect(e).not.toBeNull();
		expect(Math.abs(e!.sx)).toBeCloseTo(BALL_OFFSCREEN_EDGE_MARGIN, 5);
		expect(Math.abs(e!.sy)).toBeLessThan(BALL_OFFSCREEN_EDGE_MARGIN);
	});

	it("flipuje osie gdy z>1 (za kamerą)", () => {
		const front = ballOffScreenEdgeNdc(2, 0, 0.5)!;
		const behind = ballOffScreenEdgeNdc(2, 0, 1.5)!;
		expect(Math.sign(behind.sx)).toBe(-Math.sign(front.sx));
	});
});
