import { describe, expect, it } from "vitest";

import {
	DEMOLISH_IMPACT_MIN,
	DemolishHighlight,
} from "../../src/visual/demolishHighlight";

describe("DemolishHighlight", () => {
	it("nie triggeruje poniżej progu", () => {
		const h = new DemolishHighlight();
		h.trigger(DEMOLISH_IMPACT_MIN - 1, "attacker");
		expect(h.isActive()).toBe(false);
	});

	it("DEMOLISH! gdy gracz demo'uje", () => {
		const h = new DemolishHighlight();
		h.trigger(14, "attacker");
		expect(h.isActive()).toBe(true);
		expect(h.getPresentation().label).toBe("DEMOLISH!");
	});

	it("BOOM! przy bardzo mocnym uderzeniu", () => {
		const h = new DemolishHighlight();
		h.trigger(18, "attacker");
		expect(h.getPresentation().label).toBe("BOOM!");
	});

	it("WRECKED gdy gracz dostaje demo", () => {
		const h = new DemolishHighlight();
		h.trigger(12, "victim");
		expect(h.getPresentation().label).toBe("WRECKED");
	});

	it("fade po update", () => {
		const h = new DemolishHighlight();
		h.trigger(14, "attacker");
		for (let i = 0; i < 55; i++) {
			h.update(1 / 60);
		}
		expect(h.isActive()).toBe(false);
	});
});
