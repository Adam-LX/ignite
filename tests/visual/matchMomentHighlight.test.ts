import { describe, expect, it } from "vitest";
import { MatchMomentHighlight } from "../../src/visual/matchMoments/matchMoments";

describe("MatchMomentHighlight presentation", () => {
	it("trigger ustawia label i soft shake envelope", () => {
		const h = new MatchMomentHighlight();
		expect(
			h.trigger({
				id: "wall_shot",
				label: "WALL HIT!",
				priority: 34,
				intensity: 0.55,
				duration: 0.55,
				cooldown: 1.4,
			}),
		).toBe(true);
		expect(h.isActive()).toBe(true);
		const p0 = h.getPresentation();
		expect(p0.label).toBe("WALL HIT!");
		expect(p0.momentId).toBe("wall_shot");
		expect(p0.shake).toBeLessThanOrEqual(0.22 * 0.55 + 1e-6);
		expect(p0.fovBoost).toBeLessThanOrEqual(4 * 0.55 + 1e-6);
		h.update(0.3);
		expect(h.getPresentation().shake).toBe(0);
	});

	it("cooldown blokuje spam trigger", () => {
		const h = new MatchMomentHighlight();
		h.trigger({
			id: "aerial",
			label: "AERIAL!",
			priority: 38,
			intensity: 0.65,
			duration: 0.7,
			cooldown: 1.2,
		});
		expect(
			h.trigger({
				id: "wall_shot",
				label: "WALL HIT!",
				priority: 34,
				intensity: 0.55,
				duration: 0.55,
				cooldown: 1.4,
			}),
		).toBe(false);
	});

	it("reset czyści aktywny flash", () => {
		const h = new MatchMomentHighlight();
		h.trigger({
			id: "flip_reset",
			label: "FLIP RESET!",
			priority: 42,
			intensity: 0.55,
			duration: 0.62,
			cooldown: 1.05,
		});
		h.reset();
		expect(h.isActive()).toBe(false);
		expect(h.getPresentation().label).toBe("");
	});
});
