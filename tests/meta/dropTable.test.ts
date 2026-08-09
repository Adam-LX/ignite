import { describe, expect, it, beforeEach } from "vitest";

import carCatalog from "../../public/assets/cars/car-catalog.json";
import itemCatalog from "../../public/assets/items/item-catalog.json";
import paintCatalog from "../../public/assets/items/paint-catalog.json";
import { primeCarCatalog, setCarCatalogForTests } from "../../src/meta/CarCatalog";
import {
	makeCosmeticRef,
	primeItemCatalog,
	setItemCatalogForTests,
} from "../../src/meta/CosmeticCatalog";
import {
	primePaintCatalog,
	setPaintCatalogForTests,
} from "../../src/meta/PaintCatalog";
import {
	isInstanceUnlocked,
	PlayerInventory,
	unlockCosmetic,
} from "../../src/meta/PlayerInventory";
import {
	computeDropChance,
	computeRollAttempts,
	hasLockedDrops,
	rollMatchDrop,
	rollCrateItem,
} from "../../src/meta/DropTable";

describe("DropTable v3 flood", () => {
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

	it("ranked nie dropuje", () => {
		const result = rollMatchDrop(
			{
				won: true,
				blueScore: 3,
				orangeScore: 1,
				modeId: "1v1",
				online: true,
				ranked: true,
			},
			() => 0,
		);
		expect(result.kind).toBe("none");
		if (result.kind === "none") expect(result.reason).toBe("ranked");
	});

	it("pity wymusza skrzynkę po 2 meczach", () => {
		PlayerInventory.incrementMatchesSinceDrop();
		const result = rollMatchDrop(
			{
				won: false,
				blueScore: 0,
				orangeScore: 1,
				modeId: "1v1",
				online: false,
				ranked: false,
			},
			() => 0,
		);
		expect(result.kind).toBe("crate");
		if (result.kind === "crate") {
			expect(result.items.length).toBeGreaterThan(0);
			for (const item of result.items) {
				expect(isInstanceUnlocked(item)).toBe(true);
			}
		}
	});

	it("każdy mecz ma szansę 100%", () => {
		expect(computeDropChance({ won: false } as never)).toBe(1);
		expect(computeDropChance({ won: true } as never)).toBe(1);
	});

	it("wygrana daje 3+ rolli", () => {
		expect(
			computeRollAttempts(
				{
					won: true,
					blueScore: 5,
					orangeScore: 1,
					modeId: "1v1",
					online: false,
					ranked: false,
				},
				() => 0,
			),
		).toBeGreaterThanOrEqual(3);
	});

	it("rollMatchDrop zwraca tablicę itemów", () => {
		const result = rollMatchDrop(
			{
				won: true,
				blueScore: 3,
				orangeScore: 0,
				modeId: "1v1",
				online: false,
				ranked: false,
			},
			() => 0.01,
		);
		expect(result.kind).toBe("crate");
		if (result.kind === "crate") {
			expect(result.items.length).toBeGreaterThanOrEqual(1);
		}
	});

	it("rollCrateItem zwraca nieodblokowaną instancję", () => {
		const item = rollCrateItem(() => 0);
		expect(item).toBeTruthy();
		expect(isInstanceUnlocked(item!)).toBe(false);
		unlockCosmetic(item!, false);
		expect(isInstanceUnlocked(item!)).toBe(true);
	});

	it("hasLockedDrops true na starcie", () => {
		expect(hasLockedDrops()).toBe(true);
	});

	it("item rarity — min 50% common w wagach", () => {
		expect(itemCatalog.dropRules.rarityWeights.common).toBeGreaterThanOrEqual(0.5);
	});

	it("paint rarity — min 50% common+uncommon", () => {
		const pw = itemCatalog.dropRules.paintRules.rarityWeights;
		expect(pw.common + pw.uncommon).toBeGreaterThanOrEqual(0.5);
	});

	it("paintRules — 78% malowane", () => {
		expect(itemCatalog.dropRules.paintRules.paintedChance).toBe(0.78);
	});

	it("ten sam item z innym paint = osobna instancja", () => {
		const base = rollCrateItem(() => 0.01);
		expect(base).toBeTruthy();
		unlockCosmetic(base!, false);

		let painted: ReturnType<typeof rollCrateItem> = null;
		for (let i = 0; i < 40; i++) {
			const roll = rollCrateItem(() => 0.1 + i * 0.02);
			if (
				roll &&
				roll.itemId === base!.itemId &&
				roll.kind === base!.kind &&
				roll.paintId
			) {
				painted = roll;
				break;
			}
		}
		if (painted) {
			expect(isInstanceUnlocked(painted)).toBe(false);
			unlockCosmetic(painted, false);
			expect(isInstanceUnlocked(base!)).toBe(true);
			expect(isInstanceUnlocked(painted)).toBe(true);
		}
	});
});
