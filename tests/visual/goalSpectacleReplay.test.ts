import { describe, expect, it } from "vitest";

import { GoalSpectacle } from "../../src/visual/goalSpectacle";

describe("GoalSpectacle replay sync", () => {
	it("nie pulsuje prezentacji w replay — tylko jednorazowy sygnał przy bramce", () => {
		const spec = new GoalSpectacle();
		spec.triggerForReplay("blue", { x: 0, y: 1, z: 40 } as never, 0.73);
		spec.update(1.2);

		const quiet = spec.getPresentation();
		expect(quiet.shake).toBe(0);
		expect(quiet.bloom).toBe(0);
		expect(spec.isPresentationActive()).toBe(false);

		expect(spec.consumeReplayGoalCross(0.5)).toBeNull();
		expect(spec.consumeReplayGoalCross(0.74)).toBe("blue");
		expect(spec.consumeReplayGoalCross(0.9)).toBeNull();
	});
});
