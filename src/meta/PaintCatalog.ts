import { assetUrl } from "../util/assetUrl";

export type PaintRarity =
	| "common"
	| "uncommon"
	| "rare"
	| "veryRare"
	| "legendary";

export type PaintCatalogEntry = {
	id: string;
	nameKey: string;
	hex: string;
	accentHex: string;
	rarity: PaintRarity;
	finish: "standard" | "special";
};

export type PaintCatalogData = {
	schemaVersion: number;
	paints: PaintCatalogEntry[];
};

const CATALOG_URL = assetUrl("/assets/items/paint-catalog.json");

const FALLBACK: PaintCatalogData = {
	schemaVersion: 1,
	paints: [
		{
			id: "cobalt",
			nameKey: "paint.cobalt",
			hex: "0x2244cc",
			accentHex: "0x112266",
			rarity: "uncommon",
			finish: "standard",
		},
	],
};

let cached: PaintCatalogData | null = null;
let loadPromise: Promise<PaintCatalogData> | null = null;

const VALID_RARITIES = new Set<PaintRarity>([
	"common",
	"uncommon",
	"rare",
	"veryRare",
	"legendary",
]);

export async function loadPaintCatalog(): Promise<PaintCatalogData> {
	if (cached) return cached;
	if (loadPromise) return loadPromise;
	loadPromise = (async () => {
		try {
			const res = await fetch(CATALOG_URL, { cache: "no-store" });
			if (res.ok) {
				const data = (await res.json()) as PaintCatalogData;
				if (Array.isArray(data.paints) && data.paints.length > 0) {
					cached = {
						schemaVersion: data.schemaVersion ?? 1,
						paints: data.paints.map((p) => ({
							...p,
							rarity: VALID_RARITIES.has(p.rarity as PaintRarity)
								? (p.rarity as PaintRarity)
								: "common",
						})),
					};
					return cached;
				}
			}
		} catch {
			/* fallback */
		}
		cached = FALLBACK;
		return FALLBACK;
	})();
	try {
		return await loadPromise;
	} finally {
		loadPromise = null;
	}
}

export function getPaintCatalogSync(): PaintCatalogData {
	return cached ?? FALLBACK;
}

export function primePaintCatalog(): Promise<PaintCatalogData> {
	return loadPaintCatalog();
}

export function getPaintEntry(id: string): PaintCatalogEntry | undefined {
	return getPaintCatalogSync().paints.find((p) => p.id === id);
}

export function getAllPaintIds(): string[] {
	return getPaintCatalogSync().paints.map((p) => p.id);
}

export function getPaintRarity(id: string): PaintRarity {
	return getPaintEntry(id)?.rarity ?? "common";
}

export function setPaintCatalogForTests(catalog: PaintCatalogData | null): void {
	cached = catalog;
	loadPromise = null;
}
