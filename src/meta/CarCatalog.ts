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
}

export interface CarCatalogData {
	schemaVersion: number;
	hitboxProfile: string;
	cars: CarCatalogEntry[];
}

const CATALOG_URL = assetUrl("/assets/cars/car-catalog.json");
const VALID_RARITIES = new Set<CarRarity>([
	"common",
	"rare",
	"epic",
	"legendary",
]);

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
		})),
	};
}

/** Wczytuje katalog aut (cache + fallback offline). */
export async function loadCarCatalog(): Promise<CarCatalogData> {
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
			/* brak pliku — fallback */
		}
		cachedCatalog = FALLBACK_CATALOG;
		return FALLBACK_CATALOG;
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
