import { describe, expect, it, beforeEach } from "vitest";

import {
	buildRlOctagonEdges,
	CORNER_ARC_STEPS,
	flattenArenaDimensions,
	getPerimeterEdgesForDefinition,
	STANDARD_ARENA_DEFINITION,
} from "../../src/arena/ArenaDefinition";
import {
	FALLBACK_ARENA_CATALOG,
	getArenaEntry,
	getDefaultArenaId,
	resolveArenaId,
	setArenaCatalogForTests,
} from "../../src/arena/ArenaCatalog";
import {
	ArenaRuntime,
	initArenaRuntime,
	resetArenaRuntime,
} from "../../src/arena/ArenaRuntime";

describe("ArenaCatalog", () => {
	beforeEach(() => {
		setArenaCatalogForTests(FALLBACK_ARENA_CATALOG);
		resetArenaRuntime();
	});

	it("domyślna mapa to standard", () => {
		expect(getDefaultArenaId()).toBe("standard");
		expect(resolveArenaId("unknown")).toBe("standard");
	});

	it("fallback ma standard i compact", () => {
		expect(FALLBACK_ARENA_CATALOG.arenas.length).toBeGreaterThanOrEqual(2);
		expect(getArenaEntry("compact")?.dimensions.width).toBe(64);
	});
});

describe("ArenaRuntime", () => {
	beforeEach(() => {
		setArenaCatalogForTests(FALLBACK_ARENA_CATALOG);
		resetArenaRuntime();
	});

	it("setActive zmienia wymiary RL_ARENA proxy", () => {
		initArenaRuntime("standard");
		expect(ArenaRuntime.getDimensions().WIDTH).toBe(80);
		ArenaRuntime.setActive("compact");
		expect(ArenaRuntime.getDimensions().WIDTH).toBe(64);
		expect(ArenaRuntime.getDimensions().LENGTH).toBe(96);
	});

	it("compact ma mniejszy obwód bramkowy", () => {
		ArenaRuntime.setActive("standard");
		const stdEdges = ArenaRuntime.getPerimeterEdges();
		ArenaRuntime.setActive("compact");
		const compactEdges = ArenaRuntime.getPerimeterEdges();
		expect(compactEdges.length).toBe(stdEdges.length);
		const stdGw = STANDARD_ARENA_DEFINITION.dimensions.goalWidth / 2;
		const compactDef = getArenaEntry("compact")!;
		const cGw = compactDef.dimensions.goalWidth / 2;
		expect(cGw).toBeLessThan(stdGw);
	});

	it("custom vault ma własne edges", () => {
		setArenaCatalogForTests({
			schemaVersion: 1,
			arenas: [
				...FALLBACK_ARENA_CATALOG.arenas,
				{
					id: "vault",
					nameKey: "arena.vault",
					defaultUnlocked: false,
					dimensions: {
						width: 72,
						length: 108,
						height: 38,
						cornerCut: 14,
						goalWidth: 16,
						goalHeight: 6,
						goalDepth: 6,
						rampSize: 2.5,
					},
					perimeterPreset: "custom",
					customEdges: [
						{ ax: -20, az: -54, bx: -8, bz: -54 },
						{ ax: 8, az: -54, bx: 20, bz: -54 },
					],
					manifest: "/assets/arenas/vault/manifest.json",
					spawns: { preset: "rlKickoff", scaleFromStandard: 0.9 },
					boostPads: { preset: "rlSoccar", enabled: false },
				},
			],
		});
		ArenaRuntime.setActive("vault");
		const edges = getPerimeterEdgesForDefinition(ArenaRuntime.get());
		expect(edges.length).toBe(2);
	});

	it("buildRlOctagonEdges symetryczne ±X", () => {
		const d = flattenArenaDimensions(STANDARD_ARENA_DEFINITION.dimensions);
		const edges = buildRlOctagonEdges(d);
		/** 8 prostych (końce+boki) + 4 narożniki × CORNER_ARC_STEPS. */
		expect(edges.length).toBe(8 + 4 * CORNER_ARC_STEPS);
	});
});
