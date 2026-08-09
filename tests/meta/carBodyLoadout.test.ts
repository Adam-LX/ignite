import { describe, expect, it, beforeEach } from "vitest";

import { setCarCatalogForTests } from "../../src/meta/CarCatalog";
import {
	applyCarBodyCosmeticToAllUnlockedCars,
	copyCarBodyLoadout,
	equipCar,
	equipCosmetic,
	getCarBodyLoadout,
	getEquippedCarId,
	getEquippedWheelId,
	getPlayerInventory,
	resetPlayerInventoryForTests,
	setGarageCustomizeCarId,
	swapCarBodyLoadoutBetweenCars,
	unlockCosmetic,
} from "../../src/meta/PlayerInventory";
import {
	makeCosmeticRef,
	setItemCatalogForTests,
} from "../../src/meta/CosmeticCatalog";

describe("per-car wheel loadout (RL)", () => {
	beforeEach(() => {
		resetPlayerInventoryForTests();
		setCarCatalogForTests({
			schemaVersion: 2,
			hitboxProfile: "octane",
			cars: [
				{
					id: "octane",
					nameKey: "garage.car.octane",
					glb: "/assets/models/car.glb",
					tintable: true,
					defaultUnlocked: true,
				},
				{
					id: "muscle",
					nameKey: "garage.car.muscle",
					glb: "/assets/cars/muscle.glb",
					tintable: true,
					defaultUnlocked: true,
				},
			],
		});
		setItemCatalogForTests({
			schemaVersion: 1,
			dropRules: {} as never,
			crate: { id: "crate", glb: "/x.glb" },
			trails: [],
			wheels: [
				{
					id: "default",
					nameKey: "wheel.default",
					rarity: "common",
					defaultUnlocked: true,
				},
				{
					id: "steel",
					nameKey: "wheel.steel",
					rarity: "common",
					defaultUnlocked: false,
					glb: "/assets/items/wheels/steel.glb",
				},
			],
			toppers: [],
			decals: [],
			goalExplosions: [],
		});
		unlockCosmetic(makeCosmeticRef("car", "muscle", null), false);
		unlockCosmetic(makeCosmeticRef("wheel", "steel", null), false);
		equipCar("octane");
	});

	it("stores wheels per car body", () => {
		setGarageCustomizeCarId("muscle");
		equipCosmetic(makeCosmeticRef("wheel", "steel", null), "muscle");

		expect(getEquippedWheelId("muscle")).toBe("steel");
		expect(getEquippedWheelId("octane")).toBe("default");
		expect(getCarBodyLoadout("muscle").wheel.itemId).toBe("steel");
	});

	it("applyCarBodyCosmeticToAllUnlockedCars equips on every owned car", () => {
		setGarageCustomizeCarId("muscle");
		equipCosmetic(makeCosmeticRef("wheel", "steel", null), "muscle");
		applyCarBodyCosmeticToAllUnlockedCars(
			makeCosmeticRef("wheel", "steel", null),
		);

		expect(getEquippedWheelId("octane")).toBe("steel");
		expect(getEquippedWheelId("muscle")).toBe("steel");
	});

	it("swapCarBodyLoadoutBetweenCars exchanges presets", () => {
		equipCosmetic(makeCosmeticRef("wheel", "steel", null), "muscle");
		swapCarBodyLoadoutBetweenCars("octane", "muscle");

		expect(getEquippedWheelId("octane")).toBe("steel");
		expect(getEquippedWheelId("muscle")).toBe("default");
	});

	it("copyCarBodyLoadout moves preset between cars", () => {
		equipCosmetic(makeCosmeticRef("wheel", "steel", null), "muscle");
		copyCarBodyLoadout("muscle", "octane");

		expect(getEquippedWheelId("octane")).toBe("steel");
		expect(getEquippedWheelId("muscle")).toBe("steel");
	});

	it("selecting a car body sets the match-active car while keeping per-car wheels", () => {
		equipCosmetic(makeCosmeticRef("wheel", "steel", null), "muscle");
		equipCosmetic(makeCosmeticRef("wheel", "default", null), "octane");

		expect(equipCar("muscle")).toBe(true);
		expect(getEquippedCarId()).toBe("muscle");
		expect(getEquippedWheelId("muscle")).toBe("steel");
		expect(getEquippedWheelId("octane")).toBe("default");

		expect(equipCar("octane")).toBe(true);
		expect(getEquippedCarId()).toBe("octane");
		expect(getEquippedWheelId("muscle")).toBe("steel");
		expect(getEquippedWheelId("octane")).toBe("default");
	});

	it("equipCar unlocks catalog body and persists across inventory sanitize", () => {
		expect(equipCar("muscle")).toBe(true);
		expect(getEquippedCarId()).toBe("muscle");
		expect(getPlayerInventory().equipped.car.itemId).toBe("muscle");
		expect(equipCar("muscle")).toBe(true);
	});
});
