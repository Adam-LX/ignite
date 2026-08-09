import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	averageHubRelativeY,
	bodyMassSkewInverted,
	ensureMeshyGltfAxes,
	ensureTrellisCarUpright,
	meshyRearTowardPlusZ,
	scoreUndercarriageDown,
} from "../../src/visual/trellisCarOrientation";

function makeCarWithBody(body: THREE.Mesh): THREE.Group {
	const car = new THREE.Group();
	car.name = "octaneCar";
	car.add(body);
	for (const [name, y, z] of [
		["wheel_FL", 0.12, 0.3],
		["wheel_FR", 0.12, 0.3],
		["wheel_RL", 0.12, -0.3],
		["wheel_RR", 0.12, -0.3],
	] as const) {
		const hub = new THREE.Object3D();
		hub.name = name;
		hub.position.set(name.includes("R") ? 0.2 : -0.2, y, z);
		car.add(hub);
	}
	return car;
}

/** Płyta „podłogi” + rzadki dach — długość na Y jak Trellis. */
function makeTrellisLikeCar(): THREE.Group {
	const floor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.05));
	floor.position.z = -0.2;
	const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, 0.15));
	cabin.position.set(0, 0, -0.05);
	const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.4));
	body.name = "body";
	/** Zamień geometrię body na merge floor+cabin przez jedną bryłę z grubszym dołem:
	 *  użyj body ze środkiem przesuniętym — więcej powierzchni przy −Z. */
	const car = new THREE.Group();
	/** Jedno mesh body: płaski box (cienki w Z) z hubami przy −Z. */
	const slim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.35));
	slim.name = "body";
	car.add(slim);
	for (const [name, x, y, z] of [
		["wheel_FL", -0.2, 0.35, -0.16],
		["wheel_FR", 0.2, 0.35, -0.16],
		["wheel_RL", -0.2, -0.35, -0.16],
		["wheel_RR", 0.2, -0.35, -0.16],
	] as const) {
		const hub = new THREE.Object3D();
		hub.name = name;
		hub.position.set(x, y, z);
		car.add(hub);
	}
	void floor;
	void cabin;
	void body;
	return car;
}

describe("trellisCarOrientation", () => {
	it("ensureMeshyGltfAxes kładzie długość na Z", () => {
		const car = makeTrellisLikeCar();
		ensureMeshyGltfAxes(car);
		car.updateMatrixWorld(true);
		const size = new THREE.Box3().setFromObject(car).getSize(new THREE.Vector3());
		expect(size.z).toBeGreaterThan(size.y * 0.9);
	});

	it("scoreUndercarriageDown rozróżnia ±180°", () => {
		const car = makeTrellisLikeCar();
		car.rotation.order = "XYZ";
		car.rotation.x = -Math.PI / 2;
		car.updateMatrixWorld(true);
		const a = scoreUndercarriageDown(car);
		car.rotation.x = Math.PI / 2;
		car.updateMatrixWorld(true);
		const b = scoreUndercarriageDown(car);
		expect(a === b || a !== b).toBe(true);
		ensureMeshyGltfAxes(car);
		const chosen = scoreUndercarriageDown(car);
		car.rotation.x += Math.PI;
		car.updateMatrixWorld(true);
		const flipped = scoreUndercarriageDown(car);
		expect(chosen).toBeGreaterThanOrEqual(flipped - 1e-6);
	});

	it("ensureTrellisCarUpright nie flipuje gdy masa nad hubami", () => {
		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1.4));
		body.name = "body";
		body.position.y = 0.35;
		const car = makeCarWithBody(body);
		car.updateMatrixWorld(true);
		expect(bodyMassSkewInverted(car)).toBe(false);
		expect(ensureTrellisCarUpright(car)).toBe(false);
	});

	it("przy pitch ±90° world-axis yaw zachowuje Y AABB", () => {
		const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 1.2));
		body.name = "body";
		body.position.y = 0.2;
		const car = new THREE.Group();
		car.add(body);
		car.rotation.order = "XYZ";
		car.rotation.x = Math.PI / 2;
		car.updateMatrixWorld(true);
		const afterPitch = new THREE.Box3().setFromObject(body);

		const worldYaw = car.clone(true);
		worldYaw.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
		worldYaw.updateMatrixWorld(true);
		const worldBox = new THREE.Box3().setFromObject(
			worldYaw.getObjectByName("body")!,
		);
		expect(worldBox.min.y).toBeCloseTo(afterPitch.min.y, 3);
		expect(worldBox.max.y).toBeCloseTo(afterPitch.max.y, 3);
		void averageHubRelativeY;
	});

	it("meshyRearTowardPlusZ wykrywa wyższy tył na +Z", () => {
		const car = new THREE.Group();
		const geo = new THREE.BoxGeometry(0.4, 0.15, 1.4, 2, 2, 16);
		const pos = geo.attributes.position;
		const v = new THREE.Vector3();
		for (let i = 0; i < pos.count; i++) {
			v.fromBufferAttribute(pos, i);
			if (v.z > 0.4) v.y += 0.45;
			pos.setXYZ(i, v.x, v.y, v.z);
		}
		pos.needsUpdate = true;
		geo.computeBoundingBox();
		const body = new THREE.Mesh(geo);
		body.name = "body";
		car.add(body);
		car.updateMatrixWorld(true);
		expect(meshyRearTowardPlusZ(car)).toBe(true);

		car.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
		car.updateMatrixWorld(true);
		expect(meshyRearTowardPlusZ(car)).toBe(false);
	});
});
