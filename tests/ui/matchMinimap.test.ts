import { describe, expect, it } from "vitest";

import { worldToMinimap } from "../../src/ui/MatchMinimap";
import { RL_ARENA } from "../../src/visual/arenaConstants";

describe("MatchMinimap", () => {
	it("mapuje środek boiska na środek canvasu", () => {
		const p = worldToMinimap(0, 0, 136, 204);
		expect(p.x).toBeCloseTo(68, 1);
		expect(p.y).toBeCloseTo(102, 1);
	});

	it("mapuje bramkę blue na górę minimapy", () => {
		const p = worldToMinimap(0, -RL_ARENA.HALF_LENGTH, 136, 204);
		expect(p.y).toBeLessThan(20);
	});

	it("mapuje bramkę orange na dół minimapy", () => {
		const p = worldToMinimap(0, RL_ARENA.HALF_LENGTH, 136, 204);
		expect(p.y).toBeGreaterThan(180);
	});
});
