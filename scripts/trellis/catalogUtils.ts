import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CarCatalogData, CarCatalogEntry } from "../../src/meta/CarCatalog";

const ROOT = resolve(import.meta.dirname, "../..");
const CATALOG_PATH = resolve(ROOT, "public/assets/cars/car-catalog.json");

export function readCarCatalog(): CarCatalogData {
	return JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as CarCatalogData;
}

export function writeCarCatalog(data: CarCatalogData): void {
	writeFileSync(CATALOG_PATH, `${JSON.stringify(data, null, "\t")}\n`);
}

/** Dodaje lub aktualizuje wpis auta (pipeline Trellis). */
export function appendCarToCatalog(entry: CarCatalogEntry): void {
	const catalog = readCarCatalog();
	const idx = catalog.cars.findIndex((c) => c.id === entry.id);
	if (idx >= 0) catalog.cars[idx] = { ...catalog.cars[idx], ...entry };
	else catalog.cars.push(entry);
	writeCarCatalog(catalog);
	console.info(`Car catalog updated: ${entry.id} → ${entry.glb}`);
}
