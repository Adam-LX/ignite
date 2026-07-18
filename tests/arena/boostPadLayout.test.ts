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

	it("buildBoostPadLayout — 20 padów Soccar", () => {
		const pads = buildBoostPadLayout();
		expect(pads.length).toBe(20);
		expect(pads.filter((p) => p.big).length).toBe(6);
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
		expect(resolveBoostPadLayout().length).toBe(20);
	});
});
