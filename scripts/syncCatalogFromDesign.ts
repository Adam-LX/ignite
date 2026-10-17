/**
 * Synchronizuje car-catalog.json z data/content/cars.design.json (bez GLB).
 *   npm run catalog:sync-design
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CarCatalogEntry, CarRarity, CarBodyStyle } from "../src/meta/CarCatalog";
import { appendCarToCatalog, readCarCatalog } from "./trellis/catalogUtils.js";
import {
	promptForEmptyWheelWells,
	wheelMountsForBodyStyle,
} from "./trellis/carWheelPipeline.js";

const ROOT = resolve(import.meta.dirname, "..");

type DesignCar = {
	id: string;
	nameKey: string;
	rarity: CarRarity;
	bodyStyle: CarBodyStyle;
	defaultUnlocked: boolean;
	trellisPrompt: string;
	defaultWheelId?: string;
};

function main(): void {
	const design = JSON.parse(
		readFileSync(resolve(ROOT, "data/content/cars.design.json"), "utf8"),
	) as { cars: DesignCar[] };

	const catalog = readCarCatalog();
	const existing = new Set(catalog.cars.map((c) => c.id));

	for (const car of design.cars) {
		if (car.id === "octane" || existing.has(car.id)) continue;
		const entry: CarCatalogEntry = {
			id: car.id,
			nameKey: car.nameKey,
			glb: `/assets/cars/${car.id}.glb`,
			rarity: car.rarity,
			bodyStyle: car.bodyStyle,
			source: "trellis",
			tintable: true,
			defaultUnlocked: car.defaultUnlocked,
			generationPrompt: promptForEmptyWheelWells(car.trellisPrompt),
			wheelWellMode: car.id === "octane" ? "stock" : "empty",
			wheelMounts: wheelMountsForBodyStyle(car.bodyStyle),
			...(car.defaultWheelId ? { defaultWheelId: car.defaultWheelId } : {}),
		};
		appendCarToCatalog(entry);
		existing.add(car.id);
	}

	console.info("catalog:sync-design — gotowe");
}

main();
