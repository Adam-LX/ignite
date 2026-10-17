import { beforeEach, describe, expect, it } from "vitest";

import { setArenaCatalogForTests } from "../../src/arena/ArenaCatalog";
import {
	BIG_BOOST_PAD,
	SMALL_BOOST_PAD,
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

	it("pickup radii RL-feel: small ~car-hitbox, big szerszy", () => {
		expect(SMALL_BOOST_PAD.radius).toBeGreaterThanOrEqual(1.1);
		expect(SMALL_BOOST_PAD.radius).toBeLessThanOrEqual(1.6);
		expect(BIG_BOOST_PAD.radius).toBeGreaterThanOrEqual(2.2);
		expect(BIG_BOOST_PAD.radius).toBeLessThanOrEqual(3.0);
		expect(BIG_BOOST_PAD.radius).toBeGreaterThan(SMALL_BOOST_PAD.radius * 1.5);
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
