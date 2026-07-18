import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { PLAYFIELD_SURFACE_Y } from "../../src/visual/arenaConstants";
import {
	bodyGroundY,
	bodyShellGroundWorldY,
	clampBodyAboveWheelLine,
	defaultSpawnCenterY,
	finalizeCarGroundAlign,
	normalizeCarGroundToOrigin,
	resolveShowcasePivotY,
	showcaseCarPivotY,
	snapAllWheelsToGround,
	snapCosmeticHubsToGround,
	surfaceContactY,
	visualLowestY,
	wheelContactMinY,
	wheelGroundTargetY,
} from "../../src/visual/carWheelGround";
import { RL_CAR } from "../../src/util/rlConstants";

function addTestWheel(
	root: THREE.Group,
	name: string,
	x: number,
	y: number,
	radius = 0.125,
): void {
	const hub = new THREE.Group();
	hub.name = name;
	const tire = new THREE.Mesh(
		new THREE.CylinderGeometry(radius, radius, 0.088, 12),
	);
	tire.rotation.z = Math.PI / 2;
	hub.add(tire);
	hub.position.set(x, y, 0);
	root.add(hub);
}

describe("carWheelGround", () => {
	it("snapAllWheelsToGround wyrównuje dno opon", () => {
		const car = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1.2));
		body.name = "body";
		body.position.y = 0.2;
		car.add(body);
		addTestWheel(car, "wheel_FL", -0.4, 0.08);
		addTestWheel(car, "wheel_FR", 0.4, 0.05);
		addTestWheel(car, "wheel_RL", -0.4, 0.03);
		addTestWheel(car, "wheel_RR", 0.4, 0.1);

		const ground = bodyGroundY(car);
		snapAllWheelsToGround(car, ground);

		expect(wheelContactMinY(car)).toBeCloseTo(ground, 4);
	});

	it("snapCosmeticHubsToGround koryguje tylko huby poza linią murawy", () => {
		const car = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1.2));
		body.name = "body";
		car.add(body);
		const ground = surfaceContactY();

		const addCosmeticHub = (
			name: string,
			x: number,
			hubY: number,
			radius: number,
		) => {
			const hub = new THREE.Group();
			hub.name = name;
			hub.position.set(x, hubY, 0);
			const rim = new THREE.Group();
			rim.name = `cosmetic_rim_${name}`;
			const tire = new THREE.Mesh(
				new THREE.CylinderGeometry(radius, radius, 0.088, 12),
			);
			tire.rotation.z = Math.PI / 2;
			rim.add(tire);
			hub.add(rim);
			car.add(hub);
			return hub;
		};

		const goodHub = addCosmeticHub("wheel_FL", -0.4, ground + 0.125, 0.125);
		const badHub = addCosmeticHub("wheel_FR", 0.4, ground + 0.55, 0.125);
		const goodYBefore = goodHub.position.y;
		const badYBefore = badHub.position.y;

		const maxSnap = snapCosmeticHubsToGround(car, ground);
		expect(maxSnap).toBeGreaterThan(0.2);
		expect(goodHub.position.y).toBeCloseTo(goodYBefore, 4);
		expect(badHub.position.y).toBeLessThan(badYBefore);
		expect(badHub.position.y).toBeCloseTo(goodYBefore, 3);
		car.updateMatrixWorld(true);
		const frRim = badHub.getObjectByName("cosmetic_rim_wheel_FR")!;
		const box = new THREE.Box3().setFromObject(frRim);
		expect(box.min.y).toBeCloseTo(ground, 3);
	});

	it("wheelGroundTargetY używa PLAYFIELD_SURFACE_Y dla GLB", () => {
		const car = new THREE.Group();
		expect(wheelGroundTargetY(car, true)).toBeCloseTo(
			PLAYFIELD_SURFACE_Y + 0.022,
			4,
		);
	});

	it("showcaseCarPivotY = surfaceContactY + hitboxHalfY", () => {
		expect(showcaseCarPivotY()).toBeCloseTo(
			surfaceContactY() + RL_CAR.hitboxHalfY,
			4,
		);
	});

	it("clampBodyAboveWheelLine podnosi body poniżej kół", () => {
		const car = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1.2));
		body.name = "body";
		body.position.y = 0.05;
		car.add(body);
		addTestWheel(car, "wheel_FL", -0.4, 0.12);
		addTestWheel(car, "wheel_FR", 0.4, 0.12);
		addTestWheel(car, "wheel_RL", -0.4, 0.12);
		addTestWheel(car, "wheel_RR", 0.4, 0.12);

		clampBodyAboveWheelLine(car);
		car.updateMatrixWorld(true);
		const wheelY = wheelContactMinY(car)!;
		expect(bodyGroundY(car)).toBeGreaterThanOrEqual(wheelY - 0.002);
	});

	it("clampBodyAboveWheelLine przy felgach podnosi skorupę do linii kół", () => {
		const car = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1.2));
		body.name = "body";
		body.position.y = 0.02;
		car.add(body);
		const hubs: Array<[string, number, number]> = [
			["wheel_FL", -0.4, 0.4],
			["wheel_FR", 0.4, 0.4],
			["wheel_RL", -0.4, -0.4],
			["wheel_RR", 0.4, -0.4],
		];
		for (const [name, x, z] of hubs) {
			const hub = new THREE.Object3D();
			hub.name = name;
			hub.position.set(x, 0.2, z);
			const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 8));
			rim.name = `cosmetic_rim_${name}`;
			hub.add(rim);
			car.add(hub);
		}
		clampBodyAboveWheelLine(car);
		car.updateMatrixWorld(true);
		const wheelY = wheelContactMinY(car)!;
		expect(bodyShellGroundWorldY(body, car)).toBeGreaterThanOrEqual(wheelY - 0.002);
	});
	it("defaultSpawnCenterY = surfaceContactY + hitboxHalfY", () => {
		expect(defaultSpawnCenterY()).toBeCloseTo(
			surfaceContactY() + RL_CAR.hitboxHalfY,
			4,
		);
	});

	it("resolveShowcasePivotY kompensuje skalę menu", () => {
		const car = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1.2));
		body.name = "body";
		body.position.y = 0.2;
		car.add(body);
		addTestWheel(car, "wheel_FL", -0.4, 0.08);
		addTestWheel(car, "wheel_FR", 0.4, 0.08);
		addTestWheel(car, "wheel_RL", -0.4, 0.08);
		addTestWheel(car, "wheel_RR", 0.4, 0.08);
		normalizeCarGroundToOrigin(car);

		const scale = 2.45;
		car.scale.setScalar(scale);
		const parent = new THREE.Group();
		parent.add(car);
		const pivot = resolveShowcasePivotY(car, scale);
		parent.position.y = pivot;
		parent.updateMatrixWorld(true);
		expect(visualLowestY(parent)).toBeCloseTo(surfaceContactY(), 3);
	});

	it("finalizeCarGroundAlign normalizuje dno do y=0", () => {
		const car = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1.2));
		body.name = "body";
		body.position.y = 0.05;
		car.add(body);
		addTestWheel(car, "wheel_FL", -0.4, 0.12);
		addTestWheel(car, "wheel_FR", 0.4, 0.12);
		addTestWheel(car, "wheel_RL", -0.4, 0.12);
		addTestWheel(car, "wheel_RR", 0.4, 0.12);

		finalizeCarGroundAlign(car, true);
		expect(visualLowestY(car)).toBeCloseTo(0, 4);
	});

});
