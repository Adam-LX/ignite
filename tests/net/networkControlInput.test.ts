import { describe, expect, it } from "vitest";

import { NetworkControlInput } from "../../src/net/NetworkControlInput";
import type { InputFramePayload } from "../../src/net/protocol";

function frame(partial: Partial<InputFramePayload> = {}): InputFramePayload {
	return {
		seq: 1,
		tickHint: 1,
		forward: 0,
		yaw: 0,
		roll: 0,
		boost: false,
		shift: false,
		jumpHeld: false,
		jumpEdge: false,
		recover: false,
		...partial,
	};
}

describe("NetworkControlInput", () => {
	it("keeps jump edge when later frames overwrite without edge", () => {
		const input = new NetworkControlInput();
		input.applyFrame(frame({ jumpEdge: true }));
		input.applyFrame(frame({ jumpEdge: false }));
		input.applyFrame(frame({ jumpEdge: false }));

		expect(input.consumeJump()).toBe(true);
		expect(input.consumeJump()).toBe(false);
	});

	it("queues multiple jump edges from burst frames", () => {
		const input = new NetworkControlInput();
		input.applyFrame(frame({ jumpEdge: true }));
		input.applyFrame(frame({ jumpEdge: true }));

		expect(input.consumeJump()).toBe(true);
		expect(input.consumeJump()).toBe(true);
		expect(input.consumeJump()).toBe(false);
	});

	it("keeps recover until consumed", () => {
		const input = new NetworkControlInput();
		input.applyFrame(frame({ recover: true }));
		input.applyFrame(frame({ recover: false }));

		expect(input.consumeRecover()).toBe(true);
		expect(input.consumeRecover()).toBe(false);
	});
});
