import { assetUrl } from "../util/assetUrl";
import embeddedCarCatalog from "../../public/assets/cars/car-catalog.json";

export type CarRarity = "common" | "rare" | "epic" | "legendary";

export type CarBodyStyle = "standard" | "wide" | "low" | "hatch" | "tall";

/** Średnice montażu felg — metry, oś obrotu koła = lokalne X. */
export type CarWheelMounts = {
	frontDiameterM?: number;
	rearDiameterM?: number;
	/** Delikatna korekta szerokości (0.85–1.15). */
	lateralScale?: number;
	/**
	 * Pozycja osi względem środka body (ułamek długości AABB).
	 * +Z = przód (po finalizeMeshyNosePlusZ).
	 */
	frontZFrac?: number;
	rearZFrac?: number;
};

/** stock = koła z GLB; empty = wycięte huby, tylko montaż felg. */
export type CarWheelWellMode = "stock" | "empty";

export interface CarCatalogEntry {
	id: string;
	nameKey: string;
	glb: string;
	glbOrange?: string;
	tintable: boolean;
	defaultUnlocked: boolean;
	rarity?: CarRarity;
	bodyStyle?: CarBodyStyle;
	wheelMounts?: CarWheelMounts;
	/** Domyślnie stock — koła z modelu. empty wymaga pustych wheel_* w GLB. */
	wheelWellMode?: CarWheelWellMode;
	/** Felga montowana gdy wheel=default (empty wells). Brak → factory. */
	defaultWheelId?: string;
	source?: "meshy" | "trellis" | "manual";
	generationPrompt?: string;
	/** Pin w garażu (sort priority). */
	featured?: boolean;
	/** Niższy = wyżej na liście. */
	garageSort?: number;
	/** Ukryj w UI garażu (FAIL prep / demote) — nadal w dropach jeśli unlocked. */
	garageHidden?: boolean;
	/**
	 * TEMP: branded / third-party models (license required).
	 * Live only when `public/assets/cars/_licensed_preview/` exists.
	 * Remove folder → gone from game. Kill-switch: localStorage
	 * `ignite.licensedCarsPreview=0` or `VITE_LICENSED_CARS_PREVIEW=0`.
	 */
	licensedPreview?: boolean;
}

export interface CarCatalogData {
	schemaVersion: number;
	hitboxProfile: string;
	cars: CarCatalogEntry[];
}

const CATALOG_URL = assetUrl("/assets/cars/car-catalog.json");
/** Optional overlay — missing folder = no-op (easy license cleanup). */
const LICENSED_PREVIEW_URL = assetUrl(
	"/assets/cars/_licensed_preview/catalog.json",
);
const VALID_RARITIES = new Set<CarRarity>([
	"common",
	"rare",
	"epic",
	"legendary",
]);

function licensedPreviewAllowed(): boolean {
	try {
		if (import.meta.env.VITE_LICENSED_CARS_PREVIEW === "0") return false;
	} catch {
		/* */
	}
	try {
		if (localStorage.getItem("ignite.licensedCarsPreview") === "0") {
			return false;
		}
	} catch {
		/* */
	}
	return true;
}

async function loadLicensedPreviewCars(): Promise<CarCatalogEntry[]> {
	if (!licensedPreviewAllowed()) return [];
	try {
		const res = await fetch(LICENSED_PREVIEW_URL, { cache: "no-store" });
		if (!res.ok) return [];
		const raw = (await res.json()) as { cars?: unknown };
		if (!Array.isArray(raw?.cars)) return [];
		const out: CarCatalogEntry[] = [];
		for (const c of raw.cars) {
			if (
				!c ||
				typeof c !== "object" ||
				typeof (c as CarCatalogEntry).id !== "string" ||
				typeof (c as CarCatalogEntry).glb !== "string"
			) {
				continue;
			}
			const entry = c as CarCatalogEntry;
			out.push({
				...entry,
				nameKey:
					typeof entry.nameKey === "string" && entry.nameKey
						? entry.nameKey
						: entry.id,
				rarity: normalizeRarity(entry.rarity) ?? "legendary",
				tintable: entry.tintable !== false,
				defaultUnlocked: entry.defaultUnlocked !== false,
				featured: entry.featured !== false,
				garageHidden: entry.garageHidden === true,
				licensedPreview: true,
				source: entry.source ?? "manual",
				garageSort:
					typeof entry.garageSort === "number" &&
					Number.isFinite(entry.garageSort)
						? entry.garageSort
						: 5,
			});
		}
		return out;
	} catch {
		return [];
	}
}

function mergeCarLists(
	base: CarCatalogEntry[],
	extra: CarCatalogEntry[],
): CarCatalogEntry[] {
	if (!extra.length) return base;
	const seen = new Set(base.map((c) => c.id));
	const merged = [...base];
	for (const c of extra) {
		if (seen.has(c.id)) continue;
		seen.add(c.id);
		merged.push(c);
	}
	return merged;
}

/** Offline / zanim fetch wróci — pełny katalog (import JSON), nie 3-autowy stub. */
export const FALLBACK_CATALOG: CarCatalogData = (() => {
	const parsed = normalizeCatalog(embeddedCarCatalog);
	if (parsed) return parsed;
	return {
		schemaVersion: 2,
		hitboxProfile: "octane",
		cars: [
			{
				id: "octane",
				nameKey: "garage.car.octane",
				glb: "/assets/models/car.glb",
				glbOrange: "/assets/models/car_orange.glb",
				rarity: "common" as const,
				bodyStyle: "standard" as const,
				source: "meshy" as const,
				tintable: true,
				defaultUnlocked: true,
			},
		],
	};
})();

let cachedCatalog: CarCatalogData | null = null;
let loadPromise: Promise<CarCatalogData> | null = null;

function normalizeRarity(raw: unknown): CarRarity | undefined {
	if (typeof raw !== "string") return undefined;
	return VALID_RARITIES.has(raw as CarRarity) ? (raw as CarRarity) : undefined;
}

function normalizeCatalog(raw: unknown): CarCatalogData | null {
	if (!raw || typeof raw !== "object") return null;
	const data = raw as CarCatalogData;
	if (!Array.isArray(data.cars) || data.cars.length === 0) return null;
	const seen = new Set<string>();
	const cars = data.cars.filter((c) => {
		if (
			!c ||
			typeof c.id !== "string" ||
			typeof c.glb !== "string" ||
			typeof c.nameKey !== "string"
		) {
			return false;
		}
		if (seen.has(c.id)) return false;
		seen.add(c.id);
		return true;
	});
	if (cars.length === 0) return null;
	return {
		schemaVersion: data.schemaVersion ?? 1,
		hitboxProfile: data.hitboxProfile ?? "octane",
		cars: cars.map((c) => ({
			...c,
			rarity: normalizeRarity(c.rarity) ?? "common",
			tintable: c.tintable !== false,
			defaultUnlocked: c.defaultUnlocked === true,
			featured: c.featured === true,
			garageHidden: c.garageHidden === true,
			garageSort:
				typeof c.garageSort === "number" && Number.isFinite(c.garageSort)
					? c.garageSort
					: c.featured === true
						? 20
						: 70,
		})),
	};
}

/** Lista garażu: bez FAIL/hidden, featured + garageSort. */
export function listGarageCars(opts?: {
	includeHidden?: boolean;
}): CarCatalogEntry[] {
	const includeHidden = opts?.includeHidden === true;
	return getCarCatalogSync()
		.cars.filter((c) => includeHidden || !c.garageHidden)
		.slice()
		.sort((a, b) => {
			const fa = a.featured ? 0 : 1;
			const fb = b.featured ? 0 : 1;
			if (fa !== fb) return fa - fb;
			const sa = a.garageSort ?? 70;
			const sb = b.garageSort ?? 70;
			if (sa !== sb) return sa - sb;
			return a.id.localeCompare(b.id);
		});
}

/** Wczytuje katalog aut (cache + fallback offline). */
export async function loadCarCatalog(): Promise<CarCatalogData> {
	if (cachedCatalog) return cachedCatalog;
	if (loadPromise) return loadPromise;

	loadPromise = (async () => {
		let base: CarCatalogData = FALLBACK_CATALOG;
		try {
			const res = await fetch(CATALOG_URL, { cache: "no-store" });
			if (res.ok) {
				const parsed = normalizeCatalog(await res.json());
				if (parsed) base = parsed;
			}
		} catch {
			/* brak pliku — fallback */
		}
		const licensed = await loadLicensedPreviewCars();
		if (licensed.length) {
			cachedCatalog = {
				...base,
				cars: mergeCarLists(base.cars, licensed),
			};
			if (import.meta.env.DEV) {
				console.info(
					`[Ignite] licensed car preview: ${licensed.length} body(ies) — delete public/assets/cars/_licensed_preview to remove`,
				);
			}
			return cachedCatalog;
		}
		cachedCatalog = base;
		return base;
	})();

	try {
		return await loadPromise;
	} finally {
		loadPromise = null;
	}
}

export function getCarCatalogSync(): CarCatalogData {
	return cachedCatalog ?? FALLBACK_CATALOG;
}

export function getCarEntry(carId: string): CarCatalogEntry | undefined {
	return getCarCatalogSync().cars.find((c) => c.id === carId);
}

/** Branded preview GLBs — keep stock meshes/materials; skip Octane cosmetics pipeline. */
export function carIsLicensedPreview(carId: string | undefined | null): boolean {
	const id = resolveCarId(carId);
	if (getCarEntry(id)?.licensedPreview) return true;
	return id.startsWith("lic_");
}

export function getDefaultCarId(): string {
	return "octane";
}

export function resolveCarId(carId: string | undefined | null): string {
	if (carId && getCarEntry(carId)) return carId;
	return getDefaultCarId();
}

/** Puste nadkola — felgi montowane z GLB (factory / kosmetyk). */
export function carUsesEmptyWheelWells(carId: string): boolean {
	return getCarEntry(resolveCarId(carId))?.wheelWellMode === "empty";
}

/** Domyślna felga GLB per auto (wheel=default, empty wells). */
export function getDefaultWheelIdForCar(carId: string): string {
	const id = resolveCarId(carId);
	const entry = getCarEntry(id);
	if (entry?.defaultWheelId) return entry.defaultWheelId;
	if (entry?.wheelWellMode === "stock") return "default";
	return "default";
}

/** wheel=default → felga przypisana do auta (factory / dune / …). */
export function resolveWheelIdForCar(
	carId: string,
	wheelId: string,
): string {
	if (wheelId !== "default") return wheelId;
	return getDefaultWheelIdForCar(carId);
}

export function getCarRarity(carId: string): CarRarity {
	return getCarEntry(carId)?.rarity ?? "common";
}

/** Ścieżka GLB dla drużyny (orange może mieć osobny plik). */
export function resolveCarGlbPath(
	entry: CarCatalogEntry,
	team: "blue" | "orange",
): string {
	const path =
		team === "orange" && entry.glbOrange ? entry.glbOrange : entry.glb;
	return assetUrl(path);
}

export function getDroppableCarIds(): string[] {
	return getCarCatalogSync()
		.cars.filter((c) => !c.defaultUnlocked)
		.map((c) => c.id);
}

export function getAllCarIds(): string[] {
	return getCarCatalogSync().cars.map((c) => c.id);
}

/** Losowe auto z puli (boty offline). */
export function pickRandomCarId(pool?: string[]): string {
	const ids =
		pool && pool.length > 0
			? pool.filter((id) => getCarEntry(id))
			: getAllCarIds();
	return ids[Math.floor(Math.random() * ids.length)] ?? getDefaultCarId();
}

/** Prime cache przy starcie gry. */
export function primeCarCatalog(): Promise<CarCatalogData> {
	return loadCarCatalog();
}

/** Testy — wstrzyknij katalog bez fetch. */
export function setCarCatalogForTests(catalog: CarCatalogData | null): void {
	cachedCatalog = catalog;
	loadPromise = null;
}
