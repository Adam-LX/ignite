import { describe, expect, it, beforeEach } from "vitest";

import carCatalog from "../../public/assets/cars/car-catalog.json";
import itemCatalog from "../../public/assets/items/item-catalog.json";
import paintCatalog from "../../public/assets/items/paint-catalog.json";
import { primeCarCatalog, setCarCatalogForTests } from "../../src/meta/CarCatalog";
import {
	getTrailEntry,
	instanceKey,
	makeCosmeticRef,
	primeItemCatalog,
	setItemCatalogForTests,
} from "../../src/meta/CosmeticCatalog";
import {
	getPaintEntry,
	primePaintCatalog,
	setPaintCatalogForTests,
} from "../../src/meta/PaintCatalog";
import {
	PlayerInventory,
	createDefaultInventory,
	isCosmeticNew,
	isInstanceUnlocked,
	markCosmeticSeen,
	unlockCosmetic,
} from "../../src/meta/PlayerInventory";

describe("PlayerInventory v4", () => {
	beforeEach(async () => {
		PlayerInventory.resetForTests();
		setItemCatalogForTests(itemCatalog as never);
		setCarCatalogForTests(carCatalog as never);
		setPaintCatalogForTests(paintCatalog as never);
		await Promise.all([
			primeItemCatalog(),
			primeCarCatalog(),
			primePaintCatalog(),
		]);
	});

	it("domyślnie odblokowuje default items", () => {
		const inv = createDefaultInventory();
		expect(
			inv.unlocked.some(
				(i) => i.kind === "trail" && i.itemId === "default",
			),
		).toBe(true);
		expect(inv.equipped.trail.itemId).toBe("default");
	});

	it("unlockCosmetic oznacza NEW per instancja", () => {
		const ref = makeCosmeticRef("trail", "plasma", "cobalt");
		unlockCosmetic(ref);
		expect(isCosmeticNew(ref)).toBe(true);
		expect(
			isCosmeticNew(makeCosmeticRef("trail", "plasma", null)),
		).toBe(false);
		markCosmeticSeen(ref);
		expect(isCosmeticNew(ref)).toBe(false);
	});

	it("duplikat instancji = ten sam kind+item+paint", () => {
		const ref = makeCosmeticRef("wheel", "neon", "crimson");
		expect(unlockCosmetic(ref)).toBe(true);
		expect(unlockCosmetic(ref)).toBe(false);
		expect(isInstanceUnlocked(ref)).toBe(true);
		expect(instanceKey(ref)).toBe("wheel:neon:crimson");
	});

	it("trail catalog ma kolory", () => {
		expect(getTrailEntry("plasma")?.colors.head).toBe("0x88ccff");
	});

	it("paint catalog ładuje kobalt", () => {
		expect(getPaintEntry("cobalt")?.hex).toBe("0x2244cc");
	});
});
