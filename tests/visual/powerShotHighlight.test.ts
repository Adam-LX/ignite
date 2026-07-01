import { describe, expect, it } from "vitest";

import {
	POWER_SHOT_IMPACT_MIN,
	PowerShotHighlight,
} from "../../src/visual/powerShotHighlight";

describe("PowerShotHighlight", () => {
	it("nie triggeruje poniżej progu", () => {
		const h = new PowerShotHighlight();
		h.trigger(POWER_SHOT_IMPACT_MIN - 1);
		expect(h.isActive()).toBe(false);
	});

	it("triggeruje i fade po update", () => {
		const h = new PowerShotHighlight();
		h.trigger(20);
		expect(h.isActive()).toBe(true);
		expect(h.getPresentation().label).toBe("POWER SHOT");

		for (let i = 0; i < 50; i++) {
			h.update(1 / 60);
		}
		expect(h.isActive()).toBe(false);
	});

	it("MEGA SHOT przy bardzo mocnym uderzeniu", () => {
		const h = new PowerShotHighlight();
		h.trigger(24);
		expect(h.getPresentation().label).toBe("MEGA SHOT");
	});

	it("cooldown blokuje spam", () => {
		const h = new PowerShotHighlight();
		h.trigger(20);
		h.update(0.1);
		h.trigger(20);
		// still first active window
		expect(h.getPresentation().flash).toBeGreaterThan(0);
	});
});
