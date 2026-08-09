import { describe, expect, it } from "vitest";

import {
	createEmptySimulatedInput,
	SimulatedControlInput,
} from "../../src/util/SimulatedInput";

describe("SimulatedControlInput", () => {
	it("trzymany jump nie konsumuje w nieskończoność", () => {
		const sim = createEmptySimulatedInput();
		sim.jump = true;
		const input = new SimulatedControlInput(sim);

		expect(input.consumeJump()).toBe(true);
		expect(input.consumeJump()).toBe(false);
		expect(input.consumeJump()).toBe(false);
	});

	it("ponowny rising edge po puszczeniu PPM", () => {
		const sim = createEmptySimulatedInput();
		const input = new SimulatedControlInput(sim);

		sim.jump = true;
		expect(input.consumeJump()).toBe(true);

		sim.jump = false;
		expect(input.consumeJump()).toBe(false);

		sim.jump = true;
		expect(input.consumeJump()).toBe(true);
	});
});
