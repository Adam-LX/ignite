import { describe, expect, it } from "vitest";

import {
	GoalInputRecorder,
	RecordedReplayInput,
	type ReplaySlotInput,
} from "../../src/game/InputReplay";
import type { ReplayFrame } from "../../src/game/GoalReplay";

const anchor: ReplayFrame = {
	t: 0,
	ball: {
		px: 0,
		py: 1,
		pz: 0,
		qx: 0,
		qy: 0,
		qz: 0,
		qw: 1,
		lvx: 5,
		lvy: 0,
		lvz: 0,
	},
	cars: [
		{
			px: 0,
			py: 1,
			pz: -3,
			qx: 0,
			qy: 0,
			qz: 0,
			qw: 1,
			lvx: 0,
			lvy: 0,
			lvz: 0,
			avx: 0,
			avy: 0,
			avz: 0,
		},
	],
};

describe("GoalInputRecorder", () => {
	it("buduje klip z inputów w oknie czasu", () => {
		const rec = new GoalInputRecorder();
		const input = {
			forward: () => 1,
			yaw: () => -0.5,
			roll: () => 0,
			isBoosting: () => true,
			isShiftDown: () => false,
			isJumpHeld: () => false,
			consumeJump: () => false,
			peekJump: () => false,
			consumeRecover: () => false,
			hasFlipDirection: () => true,
		};
		const cars = [{ slotIndex: 0 }] as Parameters<
			GoalInputRecorder["record"]
		>[1];

		for (let i = 0; i < 30; i++) {
			rec.record(i / 60, cars, () => input);
		}

		const clip = rec.buildClip(0, 0.4, anchor);
		expect(clip).not.toBeNull();
		expect(clip!.inputs.length).toBeGreaterThanOrEqual(2);
		expect(clip!.anchor.ball.lvx).toBe(5);
		expect(clip!.inputs[0]!.slots[0]!.forward).toBe(1);
	});
});

describe("RecordedReplayInput", () => {
	it("odtwarza jump edge z jumpHeld", () => {
		const slot: ReplaySlotInput = {
			forward: 0,
			yaw: 0,
			roll: 0,
			boost: false,
			jumpHeld: true,
			shift: false,
		};
		const input = new RecordedReplayInput(slot);
		input.setSlot(slot, true);
		expect(input.consumeJump()).toBe(true);
		expect(input.consumeJump()).toBe(false);
	});
});
