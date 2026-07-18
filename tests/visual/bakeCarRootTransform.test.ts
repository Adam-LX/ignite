import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	bakeCarRootTransform,
	centerCarOnHorizontalOrigin,
	flattenCarContentToRoot,
} from "../../src/visual/trellisCarOrientation";

describe("bakeCarRootTransform", () => {
	it("zeruje rotation/scale roota i zachowuje world pozycji dzieci", () => {
		const root = new THREE.Group();
		root.rotation.x = -Math.PI / 2;
		root.scale.setScalar(2);

		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 2));
		body.name = "body";
		body.position.set(0, 0.5, 0);
		root.add(body);

		const hub = new THREE.Object3D();
		hub.name = "wheel_FL";
		hub.position.set(-0.4, 0.1, 0.6);
		root.add(hub);

		root.updateMatrixWorld(true);
		const bodyWorldBefore = new THREE.Vector3();
		const hubWorldBefore = new THREE.Vector3();
		body.getWorldPosition(bodyWorldBefore);
		hub.getWorldPosition(hubWorldBefore);

		bakeCarRootTransform(root);

		expect(root.rotation.x).toBeCloseTo(0, 6);
		expect(root.scale.x).toBeCloseTo(1, 6);

		root.updateMatrixWorld(true);
		const bodyWorldAfter = new THREE.Vector3();
		const hubWorldAfter = new THREE.Vector3();
		body.getWorldPosition(bodyWorldAfter);
		hub.getWorldPosition(hubWorldAfter);

		expect(bodyWorldAfter.x).toBeCloseTo(bodyWorldBefore.x, 4);
		expect(bodyWorldAfter.y).toBeCloseTo(bodyWorldBefore.y, 4);
		expect(bodyWorldAfter.z).toBeCloseTo(bodyWorldBefore.z, 4);
		expect(hubWorldAfter.x).toBeCloseTo(hubWorldBefore.x, 4);
		expect(hubWorldAfter.y).toBeCloseTo(hubWorldBefore.y, 4);
		expect(hubWorldAfter.z).toBeCloseTo(hubWorldBefore.z, 4);
	});

	it("centerCarOnHorizontalOrigin ustawia środek body na x=0,z=0", () => {
		const root = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 2));
		body.name = "body";
		body.position.set(3, 0.2, -5);
		root.add(body);
		const hub = new THREE.Object3D();
		hub.position.set(3.4, 0.1, -4.4);
		root.add(hub);

		centerCarOnHorizontalOrigin(root);
		root.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(body);
		expect((box.min.x + box.max.x) * 0.5).toBeCloseTo(0, 4);
		expect((box.min.z + box.max.z) * 0.5).toBeCloseTo(0, 4);
	});

	it("flattenCarContentToRoot przenosi body i huby z wrappera car", () => {
		const root = new THREE.Group();
		const wrap = new THREE.Object3D();
		wrap.name = "car";
		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 2));
		body.name = "body";
		body.position.set(0, 0.2, 0);
		const hub = new THREE.Object3D();
		hub.name = "wheel_FL";
		hub.position.set(-0.4, 0.1, 0.5);
		wrap.add(body, hub);
		root.add(wrap);

		flattenCarContentToRoot(root);

		expect(body.parent).toBe(root);
		expect(hub.parent).toBe(root);
		expect(root.getObjectByName("car")).toBeUndefined();
	});
});
