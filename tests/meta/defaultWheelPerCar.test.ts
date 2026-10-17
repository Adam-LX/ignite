import { describe, expect, it, beforeEach } from "vitest";

import {
	getDefaultWheelIdForCar,
	resolveWheelIdForCar,
	setCarCatalogForTests,
} from "../../src/meta/CarCatalog";
import { getEquippedCarLoadout } from "../../src/visual/carCosmetics";
import { resetPlayerInventoryForTests } from "../../src/meta/PlayerInventory";

describe("default wheel per car", () => {
	beforeEach(() => {
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
					wheelWellMode: "stock",
				},
				{
					id: "buggy",
					nameKey: "garage.car.buggy",
					glb: "/assets/cars/buggy.glb",
					tintable: true,
					defaultUnlocked: false,
					wheelWellMode: "empty",
					defaultWheelId: "dune",
				},
				{
					id: "muscle",
					nameKey: "garage.car.muscle",
					glb: "/assets/cars/muscle.glb",
					tintable: true,
					defaultUnlocked: false,
					wheelWellMode: "empty",
					defaultWheelId: "muscleforge",
				},
				{
					id: "truck",
					nameKey: "garage.car.truck",
					glb: "/assets/cars/truck.glb",
					tintable: true,
					defaultUnlocked: false,
					wheelWellMode: "empty",
					defaultWheelId: "truckforge",
				},
				{
					id: "sleek",
					nameKey: "garage.car.sleek",
					glb: "/assets/cars/sleek.glb",
					tintable: true,
					defaultUnlocked: false,
					wheelWellMode: "empty",
				},
			],
		});
		resetPlayerInventoryForTests();
	});

	it("resolveWheelIdForCar maps default per catalog", () => {
		expect(getDefaultWheelIdForCar("buggy")).toBe("dune");
		expect(getDefaultWheelIdForCar("muscle")).toBe("muscleforge");
		expect(getDefaultWheelIdForCar("truck")).toBe("truckforge");
		expect(getDefaultWheelIdForCar("sleek")).toBe("default");
		expect(getDefaultWheelIdForCar("octane")).toBe("default");
		expect(resolveWheelIdForCar("buggy", "default")).toBe("dune");
		expect(resolveWheelIdForCar("buggy", "neon")).toBe("neon");
	});

	it("getEquippedCarLoadout exposes resolved default wheel", () => {
		expect(getEquippedCarLoadout("buggy").wheelId).toBe("dune");
		expect(getEquippedCarLoadout("octane").wheelId).toBe("default");
	});
});
