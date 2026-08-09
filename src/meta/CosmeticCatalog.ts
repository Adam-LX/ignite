import { getDroppableArenaIds, getArenaEntry } from "../arena/ArenaCatalog";
import { assetUrl } from "../util/assetUrl";
import { getPaintRarity, type PaintRarity } from "./PaintCatalog";
import {
	getAllCarIds,
	getCarEntry,
	getCarRarity,
	getDroppableCarIds,
	type CarRarity,
} from "./CarCatalog";
import { getAllArenaIds } from "../arena/ArenaCatalog";

export type CosmeticKind =
	| "car"
	| "arena"
	| "trail"
	| "wheel"
	| "topper"
	| "decal"
	| "goalExplosion";

/** Kosmetyki przypięte do konkretnego auta (jak felgi w RL). */
export const CAR_BODY_COSMETIC_KINDS = ["wheel", "topper", "decal"] as const;
export type CarBodyCosmeticKind = (typeof CAR_BODY_COSMETIC_KINDS)[number];

export function isCarBodyCosmeticKind(
	kind: CosmeticKind,
): kind is CarBodyCosmeticKind {
	return (CAR_BODY_COSMETIC_KINDS as readonly string[]).includes(kind);
}

export type ItemProvenanceSource =
	| "unknown"
	| "default"
	| "match_drop"
	| "duel_contract"
	| "dev";

export type ItemProvenance = {
	source: ItemProvenanceSource;
	arenaId?: string;
	season?: string;
	/** Unix ms */
	unlockedAt?: number;
};

export type CosmeticInstance = {
	kind: CosmeticKind;
	itemId: string;
	paintId: string | null;
	/** Brak / stare save = unknown po migracji. */
	provenance?: ItemProvenance;
};

export type CosmeticRef = Pick<CosmeticInstance, "kind" | "itemId" | "paintId">;

export function makeCosmeticRef(
	kind: CosmeticKind,
	itemId: string,
	paintId: string | null = null,
): CosmeticRef {
	return { kind, itemId, paintId };
}

export function provenanceLineKey(prov: ItemProvenance | undefined): string {
	if (!prov || prov.source === "unknown") return "collection.provenance.unknown";
	if (prov.source === "default") return "collection.provenance.default";
	if (prov.source === "dev") return "collection.provenance.dev";
	if (prov.source === "match_drop") return "collection.provenance.matchDrop";
	if (prov.source === "duel_contract") return "collection.provenance.duelContract";
	return "collection.provenance.unknown";
}

export function instanceKey(ref: CosmeticInstance): string {
	return `${ref.kind}:${ref.itemId}:${ref.paintId ?? ""}`;
}

export const PAINTABLE_KINDS: CosmeticKind[] = [
	"car",
	"trail",
	"wheel",
	"topper",
	"decal",
	"goalExplosion",
];

export function isPaintableKind(kind: CosmeticKind): boolean {
	return kind !== "arena";
}

export type PaintRules = {
	paintedChance: number;
	rarityWeights: Record<
		"common" | "uncommon" | "rare" | "veryRare" | "legendary",
		number
	>;
};

export type CosmeticRarity = CarRarity;

export type TrailCatalogEntry = {
	id: string;
	nameKey: string;
	rarity: CosmeticRarity;
	defaultUnlocked: boolean;
	colors: { head: string; core: string; mid: string; tail: string };
};

export type WheelCatalogEntry = {
	id: string;
	nameKey: string;
	rarity: CosmeticRarity;
	defaultUnlocked: boolean;
	glb?: string;
	/** Średnica GLB przy scale=1 — opcjonalnie; runtime mierzy bbox gdy brak. */
	referenceDiameterM?: number;
};

export type TopperCatalogEntry = {
	id: string;
	nameKey: string;
	rarity: CosmeticRarity;
	defaultUnlocked: boolean;
	glb?: string;
};

export type DecalCatalogEntry = {
	id: string;
	nameKey: string;
	rarity: CosmeticRarity;
	defaultUnlocked: boolean;
	tint: { r: number; g: number; b: number } | null;
	emissive: number;
};

export type GoalExplosionCatalogEntry = {
	id: string;
	nameKey: string;
	rarity: CosmeticRarity;
	defaultUnlocked: boolean;
	preset: string;
	flashMul: number;
	bloomMul: number;
	chromaticMul: number;
	shakeMul: number;
	vignetteMul: number;
};

export type DropRules = {
	categoryWeights: Record<CosmeticKind, number>;
	rarityWeights: Record<CosmeticRarity, number>;
	pityRules: {
		matchesThreshold: number;
		guaranteedRarity: CosmeticRarity;
		pityResetOnDrop: boolean;
	};
	duplicateRerollMax: number;
	baseChance: number;
	winBonus: number;
	maxDropChance?: number;
	minRollsPerMatch?: number;
	bonusRollsOnWin?: number;
	bonusRollChanceOnLoss?: number;
	bonusRollsOnBlowout?: number;
	paintRules?: PaintRules;
};

export type ItemCatalogData = {
	schemaVersion: number;
	dropRules: DropRules;
	crate: { id: string; glb: string };
	trails: TrailCatalogEntry[];
	wheels: WheelCatalogEntry[];
	toppers: TopperCatalogEntry[];
	decals: DecalCatalogEntry[];
	goalExplosions: GoalExplosionCatalogEntry[];
};

const CATALOG_URL = assetUrl("/assets/items/item-catalog.json");

const FALLBACK: ItemCatalogData = {
	schemaVersion: 1,
	dropRules: {
		categoryWeights: {
			car: 0.15,
			arena: 0.1,
			trail: 0.15,
			wheel: 0.2,
			topper: 0.15,
			decal: 0.15,
			goalExplosion: 0.1,
		},
		rarityWeights: {
			common: 0.5,
			rare: 0.2,
			epic: 0.2,
			legendary: 0.1,
		},
		pityRules: {
			matchesThreshold: 2,
			guaranteedRarity: "epic",
			pityResetOnDrop: true,
		},
		duplicateRerollMax: 20,
		baseChance: 1,
		winBonus: 0,
		maxDropChance: 1,
		minRollsPerMatch: 1,
		bonusRollsOnWin: 2,
		bonusRollChanceOnLoss: 0.65,
		bonusRollsOnBlowout: 1,
		paintRules: {
			paintedChance: 0.78,
			rarityWeights: {
				common: 0.25,
				uncommon: 0.25,
				rare: 0.2,
				veryRare: 0.2,
				legendary: 0.1,
			},
		},
	},
	crate: { id: "ignite_supply", glb: "/assets/items/crate/ignite_supply.glb" },
	trails: [],
	wheels: [],
	toppers: [],
	decals: [],
	goalExplosions: [],
};

let cached: ItemCatalogData | null = null;
let loadPromise: Promise<ItemCatalogData> | null = null;

function normalizeCatalog(raw: unknown): ItemCatalogData | null {
	if (!raw || typeof raw !== "object") return null;
	const data = raw as ItemCatalogData;
	if (!data.dropRules || !data.trails) return null;
	return {
		...FALLBACK,
		...data,
		trails: data.trails ?? [],
		wheels: data.wheels ?? [],
		toppers: data.toppers ?? [],
		decals: data.decals ?? [],
		goalExplosions: data.goalExplosions ?? [],
	};
}

export async function loadItemCatalog(): Promise<ItemCatalogData> {
	if (cached) return cached;
	if (loadPromise) return loadPromise;
	loadPromise = (async () => {
		try {
			const res = await fetch(CATALOG_URL, { cache: "no-store" });
			if (res.ok) {
				const parsed = normalizeCatalog(await res.json());
				if (parsed) {
					cached = parsed;
					return parsed;
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

export function getItemCatalogSync(): ItemCatalogData {
	return cached ?? FALLBACK;
}

export function primeItemCatalog(): Promise<ItemCatalogData> {
	return loadItemCatalog();
}

export function getDropRules(): DropRules {
	return getItemCatalogSync().dropRules;
}

export function getPaintRules(): PaintRules {
	return (
		getItemCatalogSync().dropRules.paintRules ?? FALLBACK.dropRules.paintRules!
	);
}

export function getCrateGlbPath(): string {
	return assetUrl(getItemCatalogSync().crate.glb);
}

export function getTrailEntry(id: string): TrailCatalogEntry | undefined {
	return getItemCatalogSync().trails.find((t) => t.id === id);
}

export function getWheelEntry(id: string): WheelCatalogEntry | undefined {
	return getItemCatalogSync().wheels.find((w) => w.id === id);
}

export function getTopperEntry(id: string): TopperCatalogEntry | undefined {
	return getItemCatalogSync().toppers.find((t) => t.id === id);
}

export function getDecalEntry(id: string): DecalCatalogEntry | undefined {
	return getItemCatalogSync().decals.find((d) => d.id === id);
}

export function getGoalExplosionEntry(
	id: string,
): GoalExplosionCatalogEntry | undefined {
	return getItemCatalogSync().goalExplosions.find((g) => g.id === id);
}

export function getCosmeticNameKey(ref: CosmeticRef): string {
	switch (ref.kind) {
		case "car": {
			const e = getCarEntry(ref.itemId);
			return e?.nameKey ?? ref.itemId;
		}
		case "arena": {
			const e = getArenaEntry(ref.itemId);
			return e?.nameKey ?? ref.itemId;
		}
		case "trail":
			return getTrailEntry(ref.itemId)?.nameKey ?? ref.itemId;
		case "wheel":
			return getWheelEntry(ref.itemId)?.nameKey ?? ref.itemId;
		case "topper":
			return getTopperEntry(ref.itemId)?.nameKey ?? ref.itemId;
		case "decal":
			return getDecalEntry(ref.itemId)?.nameKey ?? ref.itemId;
		case "goalExplosion":
			return getGoalExplosionEntry(ref.itemId)?.nameKey ?? ref.itemId;
	}
}

export function getCosmeticRarity(ref: CosmeticRef): CosmeticRarity {
	switch (ref.kind) {
		case "car":
			return getCarRarity(ref.itemId);
		case "arena":
			return ref.itemId === "vault"
				? "legendary"
				: ref.itemId === "wide"
					? "epic"
					: "rare";
		case "trail":
			return getTrailEntry(ref.itemId)?.rarity ?? "common";
		case "wheel":
			return getWheelEntry(ref.itemId)?.rarity ?? "common";
		case "topper":
			return getTopperEntry(ref.itemId)?.rarity ?? "common";
		case "decal":
			return getDecalEntry(ref.itemId)?.rarity ?? "common";
		case "goalExplosion":
			return getGoalExplosionEntry(ref.itemId)?.rarity ?? "common";
	}
}

const RARITY_RANK: Record<CosmeticRarity, number> = {
	common: 0,
	rare: 1,
	epic: 2,
	legendary: 3,
};

export function maxCosmeticRarity(
	a: CosmeticRarity,
	b: CosmeticRarity,
): CosmeticRarity {
	return RARITY_RANK[a] >= RARITY_RANK[b] ? a : b;
}

function paintRarityToCosmetic(r: PaintRarity): CosmeticRarity {
	switch (r) {
		case "uncommon":
			return "common";
		case "veryRare":
			return "epic";
		case "rare":
			return "rare";
		case "legendary":
			return "legendary";
		default:
			return "common";
	}
}

export function getInstanceDisplayRarity(ref: CosmeticRef): CosmeticRarity {
	const itemR = getCosmeticRarity(ref);
	if (!ref.paintId) return itemR;
	return maxCosmeticRarity(itemR, paintRarityToCosmetic(getPaintRarity(ref.paintId)));
}

export function getPaintDisplayRarity(ref: CosmeticRef): CosmeticRarity | null {
	if (!ref.paintId) return null;
	return paintRarityToCosmetic(getPaintRarity(ref.paintId));
}

export function getPaintRarityLabelKey(paintId: string): string {
	return `paint.rarity.${getPaintRarity(paintId)}`;
}

export function getDefaultCosmeticId(kind: CosmeticKind): string {
	if (kind === "car") return "octane";
	if (kind === "arena") return "standard";
	return "default";
}

export function listCatalogIds(kind: CosmeticKind): string[] {
	switch (kind) {
		case "car":
			return getAllCarIds();
		case "arena":
			return getAllArenaIds();
		case "trail":
			return getItemCatalogSync().trails.map((t) => t.id);
		case "wheel":
			return getItemCatalogSync().wheels.map((w) => w.id);
		case "topper":
			return getItemCatalogSync().toppers.map((t) => t.id);
		case "decal":
			return getItemCatalogSync().decals.map((d) => d.id);
		case "goalExplosion":
			return getItemCatalogSync().goalExplosions.map((g) => g.id);
	}
}

export function getDroppableCosmeticIds(kind: CosmeticKind): string[] {
	switch (kind) {
		case "car":
			return getDroppableCarIds();
		case "arena":
			return getDroppableArenaIds();
		case "trail":
			return getItemCatalogSync()
				.trails.filter((t) => !t.defaultUnlocked)
				.map((t) => t.id);
		case "wheel":
			return getItemCatalogSync()
				.wheels.filter((w) => !w.defaultUnlocked)
				.map((w) => w.id);
		case "topper":
			return getItemCatalogSync()
				.toppers.filter((t) => !t.defaultUnlocked)
				.map((t) => t.id);
		case "decal":
			return getItemCatalogSync()
				.decals.filter((d) => !d.defaultUnlocked)
				.map((d) => d.id);
		case "goalExplosion":
			return getItemCatalogSync()
				.goalExplosions.filter((g) => !g.defaultUnlocked)
				.map((g) => g.id);
	}
}

export function isDefaultUnlockedCosmetic(ref: CosmeticRef): boolean {
	switch (ref.kind) {
		case "car":
			return getCarEntry(ref.itemId)?.defaultUnlocked === true;
		case "arena":
			return getArenaEntry(ref.itemId)?.defaultUnlocked === true;
		case "trail":
			return getTrailEntry(ref.itemId)?.defaultUnlocked === true;
		case "wheel":
			return getWheelEntry(ref.itemId)?.defaultUnlocked === true;
		case "topper":
			return getTopperEntry(ref.itemId)?.defaultUnlocked === true;
		case "decal":
			return getDecalEntry(ref.itemId)?.defaultUnlocked === true;
		case "goalExplosion":
			return getGoalExplosionEntry(ref.itemId)?.defaultUnlocked === true;
	}
}

export const ALL_COSMETIC_KINDS: CosmeticKind[] = [
	"car",
	"arena",
	"trail",
	"wheel",
	"topper",
	"decal",
	"goalExplosion",
];

export function setItemCatalogForTests(catalog: ItemCatalogData | null): void {
	cached = catalog;
	loadPromise = null;
}
