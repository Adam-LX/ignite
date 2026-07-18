import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { alignCarToHitbox } from "../../src/visual/carGlbLoader";
import {
	clampBodyAboveWheelLine,
	snapCosmeticHubsToGround,
	surfaceContactY,
	visualLowestY,
	wheelContactMinY,
} from "../../src/visual/carWheelGround";
import { RL_CAR } from "../../src/util/rlConstants";

function addWheel(
	root: THREE.Group,
	name: string,
	x: number,
	y: number,
	radius = 0.125,
): THREE.Group {
	const hub = new THREE.Group();
	hub.name = name;
	const tire = new THREE.Mesh(
		new THREE.CylinderGeometry(radius, radius, 0.088, 12),
	);
	tire.rotation.z = Math.PI / 2;
	hub.add(tire);
	hub.position.set(x, y, 0);
	root.add(hub);
	return hub;
}

function makeCar(): THREE.Group {
	const car = new THREE.Group();
	car.name = "bruiserCar_blue";
	const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1.2));
	body.name = "body";
	body.position.y = 0.2;
	car.add(body);
	addWheel(car, "wheel_FL", -0.4, 0.125);
	addWheel(car, "wheel_FR", 0.4, 0.125);
	addWheel(car, "wheel_RL", -0.4, 0.125);
	addWheel(car, "wheel_RR", 0.4, 0.125);
	return car;
}

describe("alignCarToHitbox", () => {
	it("kładzie dno opon na −hitboxHalfY (od spodu)", () => {
		const car = makeCar();
		alignCarToHitbox(car);
		car.updateMatrixWorld(true);
		expect(wheelContactMinY(car)).toBeCloseTo(-RL_CAR.hitboxHalfY, 4);
	});

	it("jest idempotentne przy ponownym wywołaniu", () => {
		const car = makeCar();
		alignCarToHitbox(car);
		const y1 = car.position.y;
		const contact1 = wheelContactMinY(car)!;
		alignCarToHitbox(car);
		expect(car.position.y).toBeCloseTo(y1, 5);
		expect(wheelContactMinY(car)).toBeCloseTo(contact1, 5);
	});

	it("po błędnym snapie hubów do surfaceContactY + clamp — dno znów na hitboxie", () => {
		const car = makeCar();
		alignCarToHitbox(car);

		for (const name of ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const) {
			const hub = car.getObjectByName(name)!;
			const rim = new THREE.Group();
			rim.name = `cosmetic_rim_${name}`;
			const tire = new THREE.Mesh(
				new THREE.CylinderGeometry(0.125, 0.125, 0.088, 12),
			);
			tire.rotation.z = Math.PI / 2;
			rim.add(tire);
			hub.add(rim);
		}

		/** Symulacja starego bugu: huby na murawie, body zostaje nisko. */
		snapCosmeticHubsToGround(car, surfaceContactY());
		clampBodyAboveWheelLine(car);
		alignCarToHitbox(car);

		car.updateMatrixWorld(true);
		expect(wheelContactMinY(car)).toBeCloseTo(-RL_CAR.hitboxHalfY, 3);
		expect(visualLowestY(car)).toBeGreaterThanOrEqual(
			-RL_CAR.hitboxHalfY - 0.01,
		);
	});
});
