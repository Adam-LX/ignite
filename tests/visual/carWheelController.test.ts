import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	applyCarWheelMotion,
	detectWheelRollAxisLocal,
	resolveCarWheels,
} from "../../src/visual/carWheelController";

describe("carWheelController", () => {
	it("detects roll axis for side-mounted cylinder wheel", () => {
		const tire = new THREE.Mesh(
			new THREE.CylinderGeometry(0.35, 0.35, 0.18, 12),
		);
		tire.rotation.z = Math.PI / 2;
		tire.updateMatrix();
		const axis = detectWheelRollAxisLocal(tire);
		const world = new THREE.Vector3()
			.copy(axis)
			.applyQuaternion(tire.quaternion)
			.normalize();
		expect(Math.abs(world.dot(new THREE.Vector3(1, 0, 0)))).toBeGreaterThan(
			0.95,
		);
	});

	it("resolves four wheel hubs without reparenting", () => {
		const car = new THREE.Group();
		car.name = "octaneCar";
		for (const name of ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]) {
			const hub = new THREE.Group();
			hub.name = name;
			const tire = new THREE.Mesh(
				new THREE.CylinderGeometry(0.35, 0.35, 0.18, 12),
			);
			tire.rotation.z = Math.PI / 2;
			hub.add(tire);
			car.add(hub);
		}

		const display = new THREE.Group();
		display.name = "octaneCarDisplay";
		display.add(car);

		const nodes = resolveCarWheels(display);
		expect(nodes).toHaveLength(4);
		expect(nodes.find((n) => n.hub.name === "wheel_FL")?.isFront).toBe(true);
		expect(nodes.find((n) => n.hub.name === "wheel_RL")?.isFront).toBe(false);
	});

	it("uses rim path for cosmetic wheels", () => {
		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		const cosmetic = new THREE.Group();
		cosmetic.name = "cosmetic_rim_wheel_FL";
		cosmetic.userData.wheelMountQuat = new THREE.Quaternion();
		cosmetic.add(
			new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.18, 12)),
		);
		hub.add(cosmetic);

		const car = new THREE.Group();
		car.name = "octaneCar";
		car.add(hub);

		const nodes = resolveCarWheels(car);
		expect(nodes[0]!.rim).toBe(cosmetic);
		expect(nodes[0]!.rimBaseQuat).toBeTruthy();
		expect(nodes[0]!.rollMeshes).toHaveLength(0);
	});

	it("steers front hubs on Y and rolls hubs on X", () => {
		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		const tire = new THREE.Mesh(
			new THREE.CylinderGeometry(0.35, 0.35, 0.18, 12),
		);
		tire.rotation.z = Math.PI / 2;
		hub.add(tire);

		const car = new THREE.Group();
		car.name = "octaneCar";
		car.add(hub);

		const resolved = resolveCarWheels(car);
		const baseTire = tire.quaternion.clone();
		applyCarWheelMotion(resolved, 1.5, 0.3);

		expect(hub.rotation.order).toBe("YXZ");
		expect(hub.rotation.y).toBeCloseTo(0.3);
		expect(hub.rotation.x).toBeCloseTo(1.5);
		expect(hub.rotation.z).toBe(0);
		/** Stock mesh stays at mount — spin is on hub. */
		expect(tire.quaternion.dot(baseTire)).toBeGreaterThan(0.999);
	});

	it("cosmetic rim stays thin-on-X while hub spins", () => {
		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		const rim = new THREE.Group();
		rim.name = "cosmetic_rim_wheel_FL";
		rim.userData.wheelMountQuat = new THREE.Quaternion();
		rim.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.35)));
		hub.add(rim);

		const car = new THREE.Group();
		car.name = "octaneCar";
		car.add(hub);

		const nodes = resolveCarWheels(car);
		applyCarWheelMotion(nodes, Math.PI / 2, 0);

		hub.updateMatrixWorld(true);
		rim.updateMatrixWorld(true);
		const size = new THREE.Box3().setFromObject(rim).getSize(new THREE.Vector3());
		/** Po hub.X=90° tarcza YZ → w world: XZ (thin Y) — hub niesie spin. */
		expect(hub.rotation.x).toBeCloseTo(Math.PI / 2);
		expect(rim.quaternion.equals(nodes[0]!.rimBaseQuat!)).toBe(true);
		expect(Math.min(size.x, size.y, size.z)).toBeLessThan(0.15);
	});
});
