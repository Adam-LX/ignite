import * as THREE from "three";
import { describe, expect, it } from "vitest";

/**
 * Sockety muszą być w local space auta — world AABB przy rotation.x±90°
 * inaczej trafia w nonsens (światła „do góry”).
 */
describe("car socket local placement", () => {
	it("worldToLocal zachowuje headlight Y w obrębie body po pitch 90°", () => {
		const car = new THREE.Group();
		car.rotation.x = Math.PI / 2;
		car.updateMatrixWorld(true);

		const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 1.6));
		body.name = "body";
		car.add(body);
		car.updateMatrixWorld(true);

		const box = new THREE.Box3().setFromObject(body);
		const cx = (box.min.x + box.max.x) * 0.5;
		const w = box.max.x - box.min.x;
		const l = box.max.z - box.min.z;
		const h = box.max.y - box.min.y;
		const frontZ = box.max.z - l * 0.08;
		const lampY = box.min.y + h * 0.62;
		const lampX = w * 0.34;

		const wrong = new THREE.Object3D();
		wrong.position.set(cx - lampX, lampY, frontZ);
		car.add(wrong);
		const wrongWorld = wrong.getWorldPosition(new THREE.Vector3());

		const right = new THREE.Object3D();
		const wp = new THREE.Vector3(cx - lampX, lampY, frontZ);
		car.worldToLocal(wp);
		right.position.copy(wp);
		car.add(right);
		const rightWorld = right.getWorldPosition(new THREE.Vector3());

		expect(rightWorld.y).toBeCloseTo(lampY, 3);
		expect(rightWorld.z).toBeCloseTo(frontZ, 3);
		/** Bez worldToLocal Y w world jest zepsute przy pitch. */
		expect(Math.abs(wrongWorld.y - lampY)).toBeGreaterThan(0.2);
	});
});
