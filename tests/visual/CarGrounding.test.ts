import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	fitCarVisualToHitbox,
	hitboxWheelContactLocalY,
	measureTireContactMinY,
	RIDE_CLEARANCE,
	bodyArchBakeMinY,
} from "../../src/visual/CarGrounding";
import { setCarCatalogForTests } from "../../src/meta/CarCatalog";
import { RL_CAR } from "../../src/util/rlConstants";

function addTireHub(
	root: THREE.Group,
	name: string,
	x: number,
	hubY: number,
	radius = 0.125,
): THREE.Group {
	const hub = new THREE.Group();
	hub.name = name;
	hub.position.set(x, hubY, 0);
	const tire = new THREE.Mesh(
		new THREE.CylinderGeometry(radius, radius, 0.088, 12),
	);
	tire.rotation.z = Math.PI / 2;
	hub.add(tire);
	root.add(hub);
	return hub;
}

describe("CarGrounding", () => {
	it("RIDE_CLEARANCE jest jedynym luzem hitboxa", () => {
		expect(hitboxWheelContactLocalY()).toBeCloseTo(
			-RL_CAR.hitboxHalfY + RIDE_CLEARANCE,
			6,
		);
	});

	it("measureTireContactMinY respektuje skalę świata", () => {
		const car = new THREE.Group();
		car.userData.carId = "octane";
		addTireHub(car, "wheel_FL", -0.4, 0.125);
		addTireHub(car, "wheel_FR", 0.4, 0.125);
		addTireHub(car, "wheel_RL", -0.4, 0.125);
		addTireHub(car, "wheel_RR", 0.4, 0.125);
		car.scale.setScalar(2.45);
		car.updateMatrixWorld(true);
		const contact = measureTireContactMinY(car)!;
		const lowest = new THREE.Box3().setFromObject(car).min.y;
		expect(contact).toBeCloseTo(lowest, 3);
	});

	it("fitCarVisualToHitbox kładzie dno na target i jest idempotentne", () => {
		const car = new THREE.Group();
		car.name = "octaneCar";
		car.userData.carId = "octane";
		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1.2));
		body.name = "body";
		body.position.y = 0.2;
		car.add(body);
		addTireHub(car, "wheel_FL", -0.4, 0.125);
		addTireHub(car, "wheel_FR", 0.4, 0.125);
		addTireHub(car, "wheel_RL", -0.4, 0.125);
		addTireHub(car, "wheel_RR", 0.4, 0.125);

		const display = new THREE.Group();
		display.name = "octaneCarDisplay";
		display.userData.carId = "octane";
		display.add(car);

		fitCarVisualToHitbox(display);
		display.updateMatrixWorld(true);
		expect(measureTireContactMinY(display)).toBeCloseTo(
			hitboxWheelContactLocalY(),
			3,
		);

		const y1 = car.position.y;
		fitCarVisualToHitbox(display);
		expect(car.position.y).toBeCloseTo(y1, 5);
	});

	it("empty hub bez mesha: kontakt ≈ hubY − catalogRadius", () => {
		setCarCatalogForTests({
			schemaVersion: 2,
			hitboxProfile: "octane",
			cars: [
				{
					id: "hatch",
					nameKey: "garage.car.hatch",
					glb: "/assets/cars/hatch.glb",
					tintable: true,
					defaultUnlocked: true,
					wheelWellMode: "empty",
					bodyStyle: "hatch",
					wheelMounts: { frontDiameterM: 0.25, rearDiameterM: 0.25 },
				},
			],
		});

		const car = new THREE.Group();
		car.userData.carId = "hatch";
		for (const [name, x, z] of [
			["wheel_FL", -0.4, 0.35],
			["wheel_FR", 0.4, 0.35],
			["wheel_RL", -0.4, -0.35],
			["wheel_RR", 0.4, -0.35],
		] as const) {
			const hub = new THREE.Group();
			hub.name = name;
			hub.position.set(x, 0.2, z);
			car.add(hub);
		}
		car.updateMatrixWorld(true);
		const contact = measureTireContactMinY(car)!;
		expect(contact).toBeCloseTo(0.2 - 0.125, 3);

		setCarCatalogForTests(null);
	});

	it("bodyArchBakeMinY widzi wierzchołki w cylindrze nadkola", () => {
		const car = new THREE.Group();
		car.userData.carId = "hatch";
		const positions = [-0.4, -0.05, 0.35, -0.4, -0.09, 0.35, -0.39, -0.07, 0.35];
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		const body = new THREE.Mesh(geo);
		body.name = "body";
		car.add(body);
		const hub = new THREE.Group();
		hub.name = "wheel_FL";
		hub.position.set(-0.4, 0.2, 0.35);
		car.add(hub);
		for (const n of ["wheel_FR", "wheel_RL", "wheel_RR"] as const) {
			const h = new THREE.Group();
			h.name = n;
			h.position.set(0.4, 0.2, -0.35);
			car.add(h);
		}
		car.updateMatrixWorld(true);
		const bake = bodyArchBakeMinY(car, "hatch");
		expect(bake).toBeCloseTo(-0.09, 2);
	});
});
