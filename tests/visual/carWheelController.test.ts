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

	it("rolls only cosmetic rim meshes when mounted", () => {
		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		const stock = new THREE.Mesh(
			new THREE.CylinderGeometry(0.35, 0.35, 0.18, 12),
		);
		stock.rotation.z = Math.PI / 2;
		stock.visible = false;
		hub.add(stock);

		const cosmetic = new THREE.Group();
		cosmetic.name = "cosmetic_rim_wheel_FL";
		const tire = new THREE.Mesh(
			new THREE.CylinderGeometry(0.35, 0.35, 0.18, 12),
		);
		tire.rotation.z = Math.PI / 2;
		cosmetic.add(tire);
		hub.add(cosmetic);

		const car = new THREE.Group();
		car.name = "octaneCar";
		car.add(hub);

		const nodes = resolveCarWheels(car);
		expect(nodes).toHaveLength(1);
		expect(nodes[0]!.rollMeshes).toHaveLength(1);
		expect(nodes[0]!.rollMeshes[0]!.mesh).toBe(tire);
	});

	it("steers front hubs on Y and rolls meshes on detected axis", () => {
		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		const tire = new THREE.Mesh(
			new THREE.CylinderGeometry(0.35, 0.35, 0.18, 12),
		);
		tire.rotation.z = Math.PI / 2;
		hub.add(tire);

		const nodes = [
			{
				hub,
				baseRotX: 0,
				baseRotY: 0,
				baseRotZ: 0,
				rollMeshes: [
					{
						mesh: tire,
						baseQuat: tire.quaternion.clone(),
						rollAxis: detectWheelRollAxisLocal(tire),
					},
				],
				isFront: true,
			},
		];

		const baseQuat = tire.quaternion.clone();
		applyCarWheelMotion(nodes, 1.5, 0.3);
		expect(hub.rotation.y).toBeCloseTo(0.3);
		expect(hub.rotation.x).toBe(0);
		expect(tire.quaternion.dot(baseQuat)).toBeLessThan(0.999);
	});
});
