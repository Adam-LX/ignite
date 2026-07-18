import { assetUrl } from "../util/assetUrl";

import {
	type ArenaCatalogData,
	type ArenaDefinition,
	STANDARD_ARENA_DEFINITION,
} from "./ArenaDefinition";

const CATALOG_URL = assetUrl("/assets/arenas/arena-catalog.json");

export const FALLBACK_ARENA_CATALOG: ArenaCatalogData = {
	schemaVersion: 1,
	arenas: [
		STANDARD_ARENA_DEFINITION,
		{
			id: "compact",
			nameKey: "arena.compact",
			defaultUnlocked: true,
			dimensions: {
				width: 64,
				length: 96,
				height: 36,
				cornerCut: 13,
				goalWidth: 15,
				goalHeight: 5.5,
				goalDepth: 7.5,
				rampSize: 3.0,
			},
			perimeterPreset: "rlOctagon",
			manifest: "/assets/arenas/compact/manifest.json",
			spawns: { preset: "rlKickoff", scaleFromStandard: 0.8 },
			boostPads: { preset: "rlSoccar", enabled: false },
			atmosphere: { skyPreset: "cyberpunk", neonAccent: "orange" },
		},
	],
};

let cachedCatalog: ArenaCatalogData | null = null;
let loadPromise: Promise<ArenaCatalogData> | null = null;

function normalizeCatalog(raw: unknown): ArenaCatalogData | null {
	if (!raw || typeof raw !== "object") return null;
	const data = raw as ArenaCatalogData;
	if (!Array.isArray(data.arenas) || data.arenas.length === 0) return null;

	const arenas = data.arenas.filter(
		(a) =>
			a &&
			typeof a.id === "string" &&
			typeof a.nameKey === "string" &&
			a.dimensions &&
			typeof a.manifest === "string",
	);
	if (arenas.length === 0) return null;

	return {
		schemaVersion: data.schemaVersion ?? 1,
		arenas,
	};
}

export async function loadArenaCatalog(): Promise<ArenaCatalogData> {
	if (cachedCatalog) return cachedCatalog;
	if (loadPromise) return loadPromise;

	loadPromise = (async () => {
		try {
			const res = await fetch(CATALOG_URL, { cache: "no-store" });
			if (res.ok) {
				const parsed = normalizeCatalog(await res.json());
				if (parsed) {
					cachedCatalog = parsed;
					return parsed;
				}
			}
		} catch {
			/* fallback */
		}
		cachedCatalog = FALLBACK_ARENA_CATALOG;
		return FALLBACK_ARENA_CATALOG;
	})();

	try {
		return await loadPromise;
	} finally {
		loadPromise = null;
	}
}

export function getArenaCatalogSync(): ArenaCatalogData {
	return cachedCatalog ?? FALLBACK_ARENA_CATALOG;
}

export function getArenaEntry(arenaId: string): ArenaDefinition | undefined {
	return getArenaCatalogSync().arenas.find((a) => a.id === arenaId);
}

export function getDefaultArenaId(): string {
	return "standard";
}

export function resolveArenaId(arenaId: string | undefined | null): string {
	if (arenaId && getArenaEntry(arenaId)) return arenaId;
	return getDefaultArenaId();
}

export function getAllArenaIds(): string[] {
	return getArenaCatalogSync().arenas.map((a) => a.id);
}

export function getDroppableArenaIds(): string[] {
	return getArenaCatalogSync()
		.arenas.filter((a) => !a.defaultUnlocked)
		.map((a) => a.id);
}

export function primeArenaCatalog(): Promise<ArenaCatalogData> {
	return loadArenaCatalog();
}

/** Testy / headless — wstrzykuje katalog bez fetch. */
export function setArenaCatalogForTests(
	catalog: ArenaCatalogData | null,
): void {
	cachedCatalog = catalog;
	loadPromise = null;
}
