import { describe, expect, it } from "vitest";

import {
	CHASE_RIGS,
	chaseRigBlendAlpha,
	chaseRigByIndex,
	clampChaseRigFov,
	isBodyMountChaseRig,
	isOverheadMountChaseRig,
	isSpectacleChaseRig,
	lerpChaseRigParams,
	nextChaseRigIndex,
} from "../../src/visual/cameraPresets";

describe("cameraPresets", () => {
	it("cykl V kończy się topDown i wraca do classic", () => {
		const ids = CHASE_RIGS.map((r) => r.id);
		expect(ids).toContain("bumper");
		expect(ids).toContain("wheel");
		expect(ids).toContain("topDown");
		expect(ids).not.toContain("birdEye");
		expect(chaseRigByIndex(nextChaseRigIndex(CHASE_RIGS.length - 1)).id).toBe(
			"classic",
		);
	});

	it("topDown = overhead + lookDown; bumper = body", () => {
		const top = CHASE_RIGS.find((r) => r.id === "topDown")!;
		const bumper = CHASE_RIGS.find((r) => r.id === "bumper")!;
		const wheel = CHASE_RIGS.find((r) => r.id === "wheel")!;
		expect(isOverheadMountChaseRig(top)).toBe(true);
		expect(top.lookDown).toBe(true);
		expect(top.overheadHeight).toBeGreaterThan(12);
		expect(isBodyMountChaseRig(bumper)).toBe(true);
		expect(isSpectacleChaseRig(bumper)).toBe(true);
		expect(wheel.bodyUp).toBeGreaterThan(0.4);
	});

	it("lerp classic→sideRail zachowuje lateral", () => {
		const a = CHASE_RIGS[0]!;
		const side = CHASE_RIGS.find((r) => r.id === "sideRail")!;
		const mid = lerpChaseRigParams(a, side, 0.5);
		expect(mid.lateralOffset).toBeCloseTo(side.lateralOffset * 0.5, 5);
	});

	it("FOV zoom clamp", () => {
		expect(clampChaseRigFov(40)).toBe(72);
		expect(clampChaseRigFov(200)).toBe(114);
		expect(clampChaseRigFov(100)).toBe(100);
	});

	it("blend ease: 0→0, 1→1", () => {
		expect(chaseRigBlendAlpha(0)).toBe(0);
		expect(chaseRigBlendAlpha(1)).toBe(1);
		expect(chaseRigBlendAlpha(0.5)).toBeGreaterThan(0.5);
	});
});
