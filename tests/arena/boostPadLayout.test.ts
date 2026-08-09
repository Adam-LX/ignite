import { beforeEach, describe, expect, it } from "vitest";

import { setArenaCatalogForTests } from "../../src/arena/ArenaCatalog";
import {
	buildBoostPadLayout,
	resolveBoostPadLayout,
} from "../../src/arena/boostPadLayout";
import {
	ArenaRuntime,
	initArenaRuntime,
	resetArenaRuntime,
} from "../../src/arena/ArenaRuntime";
import { STANDARD_ARENA_DEFINITION } from "../../src/arena/ArenaDefinition";

describe("boostPadLayout", () => {
	beforeEach(() => {
		setArenaCatalogForTests({
			schemaVersion: 1,
			arenas: [STANDARD_ARENA_DEFINITION],
		});
		resetArenaRuntime();
	});

	it("buildBoostPadLayout — 28 małych + 6 dużych (Soccar)", () => {
		const pads = buildBoostPadLayout();
		expect(pads.length).toBe(34);
		const small = pads.filter((p) => !p.big);
		const big = pads.filter((p) => p.big);
		expect(small.length).toBe(28);
		expect(big.length).toBe(6);
		for (const p of small) {
			expect(p.amount).toBe(0.12);
			expect(p.respawnSec).toBe(4);
			expect(p.radius).toBeLessThan(2);
		}
		for (const p of big) {
			expect(p.amount).toBe(1);
			expect(p.respawnSec).toBe(10);
			expect(p.radius).toBeGreaterThan(2);
		}
	});

	it("resolveBoostPadLayout — puste gdy boost wyłączony", () => {
		setArenaCatalogForTests({
			schemaVersion: 1,
			arenas: [
				{
					...STANDARD_ARENA_DEFINITION,
					boostPads: { preset: "rlSoccar", enabled: false },
				},
			],
		});
		initArenaRuntime("standard");
		expect(resolveBoostPadLayout()).toEqual([]);
	});

	it("resolveBoostPadLayout — pady gdy boost włączony", () => {
		setArenaCatalogForTests({
			schemaVersion: 1,
			arenas: [
				{
					...STANDARD_ARENA_DEFINITION,
					boostPads: { preset: "rlSoccar", enabled: true },
				},
			],
		});
		initArenaRuntime("standard");
		expect(ArenaRuntime.areBoostPadsEnabled()).toBe(true);
		expect(resolveBoostPadLayout().length).toBe(34);
	});
});
