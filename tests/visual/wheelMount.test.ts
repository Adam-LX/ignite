import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { setCarCatalogForTests } from "../../src/meta/CarCatalog";
import {
	alignWheelContactToHub,
	alignWheelInstanceOnHub,
	clearHubForCosmeticMount,
	measureWheelItemDiameterM,
	prepareCarWheelWellsForLoad,
	prepareEmptyWheelWellsBeforeGroundAlign,
	purgeStrayWheelMeshesFromCar,
	removeCosmeticRim,
	repositionEmptyWheelHubsFromBody,
	resolveCarWheelDiameterM,
	restoreAllStockWheelVisuals,
	restoreStockWheelMeshes,
	stripStockWheelMeshesFromCar,
	suppressStockWheelVisuals,
} from "../../src/visual/wheelMount";
import {
	snapAllWheelsToGround,
	surfaceContactY,
	wheelContactMinY,
	wheelGroundTargetY,
} from "../../src/visual/carWheelGround";

describe("wheelMount", () => {
	it("resolveCarWheelDiameterM uses catalog wheelMounts", () => {
		setCarCatalogForTests({
			schemaVersion: 2,
			hitboxProfile: "octane",
			cars: [
				{
					id: "muscle",
					nameKey: "garage.car.muscle",
					glb: "/assets/cars/muscle.glb",
					tintable: true,
					defaultUnlocked: false,
					bodyStyle: "wide",
					wheelMounts: {
						frontDiameterM: 0.29,
						rearDiameterM: 0.31,
					},
				},
			],
		});

		expect(resolveCarWheelDiameterM("muscle", "wheel_FL")).toBeCloseTo(0.29);
		expect(resolveCarWheelDiameterM("muscle", "wheel_RR")).toBeCloseTo(0.31);
	});

	it("alignWheelInstanceOnHub centers nested GLB hierarchy", () => {
		const hub = new THREE.Group();
		const rim = new THREE.Group();
		const child = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.35));
		child.position.set(0, 0.18, 0);
		rim.add(child);
		alignWheelInstanceOnHub(rim, hub, 0.35, 0.35, "+X");
		rim.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(rim);
		const center = box.getCenter(new THREE.Vector3());
		expect(Math.abs(center.x)).toBeLessThan(0.02);
		expect(Math.abs(center.y)).toBeLessThan(0.02);
		expect(Math.abs(center.z)).toBeLessThan(0.02);
		expect(rim.position.length()).toBeLessThan(1e-6);
	});

	it("alignWheelInstanceOnHub scales to target diameter", () => {
		const hub = new THREE.Group();
		const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 12));
		wheel.rotation.z = Math.PI / 2;
		const ref = measureWheelItemDiameterM(wheel);
		alignWheelInstanceOnHub(wheel, hub, 0.25, ref, "+X");
		wheel.updateMatrixWorld(true);
		const size = new THREE.Box3().setFromObject(wheel).getSize(new THREE.Vector3());
		expect(Math.max(size.y, size.z)).toBeCloseTo(0.25, 2);
	});

	it("removeCosmeticRim restores stock visibility", () => {
		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
		stock.name = "stock_tire";
		hub.add(stock);

		const cosmetic = new THREE.Group();
		cosmetic.name = "cosmetic_rim_wheel_FL";
		cosmetic.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)));
		hub.add(cosmetic);
		stock.visible = false;

		removeCosmeticRim(hub, "wheel_FL");
		expect(hub.getObjectByName("cosmetic_rim_wheel_FL")).toBeUndefined();
		expect(stock.visible).toBe(true);
	});

	it("restoreStockWheelMeshes shows hidden stock", () => {
		const hub = new THREE.Group();
		const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
		stock.visible = false;
		hub.add(stock);
		restoreStockWheelMeshes(hub);
		expect(stock.visible).toBe(true);
	});

	it("stripStockWheelMeshesFromCar removes GLB tires from hubs", () => {
		const car = new THREE.Group();
		car.name = "octaneCar";
		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		hub.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)));
		car.add(hub);

		stripStockWheelMeshesFromCar(car);
		expect(hub.children).toHaveLength(0);
	});

	it("purgeStrayWheelMeshesFromCar removes orphan cylinder wheels", () => {
		const car = new THREE.Group();
		car.name = "hatchCar_blue";
		const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.8));
		body.name = "body";
		car.add(body);

		const stray = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 16));
		stray.name = "Cylinder";
		stray.rotation.z = Math.PI / 2;
		stray.position.set(0, 1.2, 0);
		car.add(stray);

		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		car.add(hub);

		purgeStrayWheelMeshesFromCar(car);
		expect(car.getObjectByName("Cylinder")).toBeUndefined();
		expect(car.getObjectByName("body")).toBeDefined();
	});

	it("clearHubForCosmeticMount disposes stock children", () => {
		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		hub.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)));
		clearHubForCosmeticMount(hub);
		expect(hub.children).toHaveLength(0);
	});

	it("repositionEmptyWheelHubsFromBody places hubs near body ground line", () => {
		const car = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.8));
		body.name = "body";
		body.position.set(0, 0.25, 0);
		car.add(body);

		const hub = new THREE.Object3D();
		hub.name = "wheel_FL";
		hub.position.set(0, 2.5, 0);
		car.add(hub);

		repositionEmptyWheelHubsFromBody(car);
		hub.updateMatrixWorld(true);
		const p = new THREE.Vector3();
		hub.getWorldPosition(p);
		expect(p.y).toBeLessThan(0.35);
		expect(Math.abs(p.x)).toBeGreaterThan(0.2);
	});

	it("prepareCarWheelWellsForLoad strips only when wheelWellMode=empty", () => {
		setCarCatalogForTests({
			schemaVersion: 2,
			hitboxProfile: "octane",
			cars: [
				{
					id: "stockcar",
					nameKey: "x",
					glb: "/a.glb",
					tintable: true,
					defaultUnlocked: true,
					wheelWellMode: "stock",
				},
				{
					id: "emptycar",
					nameKey: "y",
					glb: "/b.glb",
					tintable: true,
					defaultUnlocked: true,
					wheelWellMode: "empty",
				},
			],
		});

		const stockCar = new THREE.Group();
		const stockHub = new THREE.Group();
		stockHub.name = "wheel_FL";
		stockHub.add(new THREE.Mesh());
		stockCar.add(stockHub);

		prepareCarWheelWellsForLoad(stockCar, "stockcar");
		expect(stockHub.children).toHaveLength(1);

		const emptyCar = new THREE.Group();
		const emptyHub = new THREE.Group();
		emptyHub.name = "wheel_FL";
		emptyHub.add(new THREE.Mesh());
		emptyCar.add(emptyHub);

		prepareEmptyWheelWellsBeforeGroundAlign(emptyCar, "emptycar");
		expect(emptyHub.children).toHaveLength(0);

		prepareCarWheelWellsForLoad(emptyCar, "emptycar");
	});

	it("suppressStockWheelVisuals hides orphan tire meshes", () => {
		const car = new THREE.Group();
		const orphan = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
		orphan.name = "tire_front";
		car.add(orphan);

		suppressStockWheelVisuals(car);
		expect(orphan.visible).toBe(false);
	});

	it("alignWheelInstanceOnHub trzyma felgę w origin huba", () => {
		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		hub.position.y = -0.18;
		const rim = new THREE.Group();
		rim.name = "cosmetic_rim_wheel_FL";
		const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12));
		tire.rotation.z = Math.PI / 2;
		tire.position.y = 0.06;
		rim.add(tire);
		alignWheelInstanceOnHub(rim, hub, 0.36, 0.35, "+X");

		expect(rim.position.length()).toBeLessThan(1e-6);
		hub.updateMatrixWorld(true);
		rim.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(rim);
		const center = box.getCenter(new THREE.Vector3());
		expect(center.y).toBeCloseTo(-0.18, 2);
	});

	it("wheelContactMinY ignoruje niewidoczne stock opony w hubie", () => {
		const car = new THREE.Group();
		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		const hidden = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3));
		hidden.position.y = -0.5;
		hidden.visible = false;
		hub.add(hidden);
		const rim = new THREE.Group();
		rim.name = "cosmetic_rim_wheel_FL";
		const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10));
		tire.rotation.z = Math.PI / 2;
		rim.add(tire);
		hub.add(rim);
		car.add(hub);

		const contact = wheelContactMinY(car);
		expect(contact).not.toBeNull();
		expect(contact!).toBeGreaterThan(-0.5);
	});

	it("snapAllWheelsToGround aligns cosmetic rim contact to surface", () => {
		const car = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.8));
		body.name = "body";
		car.add(body);

		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		hub.position.set(-0.2, 0.55, 0.35);
		const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.13, 12));
		rim.rotation.z = Math.PI / 2;
		rim.name = "cosmetic_rim_wheel_FL";
		hub.add(rim);
		car.add(hub);

		const before = wheelContactMinY(car);
		expect(before).not.toBeNull();
		snapAllWheelsToGround(car, wheelGroundTargetY(car, true));
		const after = wheelContactMinY(car);
		expect(after).toBeCloseTo(surfaceContactY(), 3);
		expect(after!).toBeLessThan(before!);
	});

	it("restoreAllStockWheelVisuals shows stock again", () => {
		const car = new THREE.Group();
		const tire = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
		tire.name = "wheel_tire";
		tire.visible = false;
		car.add(tire);

		restoreAllStockWheelVisuals(car);
		expect(tire.visible).toBe(true);
	});
});
