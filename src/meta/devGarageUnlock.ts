import { getItemCatalogSync, makeCosmeticRef } from "./CosmeticCatalog";
import {
	getPlayerInventory,
	savePlayerInventory,
	unlockCosmetic,
} from "./PlayerInventory";

/** Dev — odblokuj felgi / topper / decal do testów garażu (jak pełny katalog RL). */
export function unlockGarageCosmeticsForDev(): void {
	if (!import.meta.env.DEV) return;
	const catalog = getItemCatalogSync();
	for (const wheel of catalog.wheels) {
		if (wheel.id === "default") continue;
		unlockCosmetic(makeCosmeticRef("wheel", wheel.id, null), false);
	}
	for (const topper of catalog.toppers) {
		if (topper.id === "default") continue;
		unlockCosmetic(makeCosmeticRef("topper", topper.id, null), false);
	}
	for (const decal of catalog.decals) {
		if (decal.id === "default") continue;
		unlockCosmetic(makeCosmeticRef("decal", decal.id, null), false);
	}
	savePlayerInventory(getPlayerInventory());
}

/** Odblokuj wszystkie karoserie z katalogu (garaż — wybór = jazda). */
export async function unlockAllGarageCarsForDev(): Promise<void> {
	const { loadCarCatalog, getCarCatalogSync } = await import("./CarCatalog");
	await loadCarCatalog();
	const { unlockCar } = await import("./PlayerInventory");
	for (const car of getCarCatalogSync().cars) {
		unlockCar(car.id);
	}
}
