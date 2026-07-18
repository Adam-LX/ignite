import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	applyBodyWheelWellMask,
	clearBodyWheelWellMask,
} from "../../src/visual/bodyWheelWellMask";
import { alignWheelInstanceOnHub } from "../../src/visual/wheelMount";

describe("bodyWheelWellMask", () => {
	it("włącza maskę gdy cosmetic_rim zamontowany", () => {
		const car = new THREE.Group();
		car.name = "octaneCar";
		car.userData.carId = "truck";

		const body = new THREE.Mesh(
			new THREE.BoxGeometry(1, 0.4, 1.8),
			new THREE.MeshStandardMaterial({ color: 0xff0000 }),
		);
		body.name = "body";
		car.add(body);

		for (const hubName of ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]) {
			const hub = new THREE.Object3D();
			hub.name = hubName;
			hub.position.set(hubName.includes("_F") ? -0.4 : -0.4, 0.15, hubName.includes("FL") || hubName.includes("FR") ? 0.5 : -0.5);
			if (hubName.includes("FR") || hubName.includes("RR")) hub.position.x *= -1;
			const rim = new THREE.Mesh(
				new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12),
				new THREE.MeshStandardMaterial(),
			);
			rim.name = `cosmetic_rim_${hubName}`;
			rim.rotation.z = Math.PI / 2;
			alignWheelInstanceOnHub(rim, hub, 0.25, 0.25, "+X");
			car.add(hub);
		}

		const display = new THREE.Group();
		display.name = "octaneCarDisplay";
		display.add(car);

		expect(applyBodyWheelWellMask(display, "truck")).toBe(true);
		const mat = body.material as THREE.MeshStandardMaterial;
		expect(mat.userData.hubMaskState?.enabled).toBe(true);
		expect(mat.userData.hubMaskState?.hubs.length).toBe(4);

		clearBodyWheelWellMask(display);
		expect(mat.userData.hubMaskState?.enabled).toBe(false);
	});
});
