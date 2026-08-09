import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { cloneCarMesh } from "../../src/visual/carVisuals";
import {
	countVisibleBodyMeshes,
	countVisibleStockTires,
	shouldDisableBloomPass,
	shouldFreezeShadowMaps,
	showcaseBloomStrength,
	showcaseDof,
	usesDirectRender,
} from "../../src/visual/garagePresentationPolicy";
import { reconcileMountedCosmeticWheels } from "../../src/visual/cosmeticGlb";

function makeShowcaseCar(): THREE.Group {
	const display = new THREE.Group();
	display.name = "octaneCarDisplay";
	const car = new THREE.Group();
	car.name = "octaneCar";

	const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1.6));
	body.name = "body";
	car.add(body);

	for (const hubName of ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]) {
		const hub = new THREE.Group();
		hub.name = hubName;
		const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 10));
		tire.name = `${hubName}_tire`;
		hub.add(tire);
		const rim = new THREE.Group();
		rim.name = `cosmetic_rim_${hubName}`;
		rim.add(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 16)));
		hub.add(rim);
		car.add(hub);
	}

	display.add(car);
	return display;
}

describe("menu showcase presentation policy", () => {
	it("menu + garaż: soft post stack z lekkim bloom (bez direct-only chalk)", () => {
		expect(usesDirectRender(true, false)).toBe(false);
		expect(usesDirectRender(false, true)).toBe(false);
		expect(usesDirectRender(false, false)).toBe(false);
		expect(shouldDisableBloomPass(true, false)).toBe(false);
		expect(shouldDisableBloomPass(false, true)).toBe(false);
		expect(shouldFreezeShadowMaps(true, false)).toBe(false);
		expect(shouldFreezeShadowMaps(false, true)).toBe(true);
		expect(showcaseBloomStrength()).toBeGreaterThan(0);
		expect(showcaseBloomStrength()).toBeLessThanOrEqual(0.35);
		expect(showcaseDof()).toBeGreaterThanOrEqual(0);
		expect(showcaseDof()).toBeLessThanOrEqual(0.2);
	});
});

describe("cloneCarMesh garage ghost guards", () => {
	it("klon ma dokładnie jedną widoczną karoserię", () => {
		const template = makeShowcaseCar();
		const clone = cloneCarMesh(template);
		expect(countVisibleBodyMeshes(clone)).toBe(1);
	});

	it("stock opony ukryte gdy GLB felgi zamontowane", () => {
		const template = makeShowcaseCar();
		reconcileMountedCosmeticWheels(template);
		const clone = cloneCarMesh(template);
		expect(countVisibleStockTires(clone)).toBe(0);
	});

	it("stock opony zostają gdy brak felg kosmetycznych", () => {
		const template = makeShowcaseCar();
		for (const hubName of ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]) {
			const hub = template.getObjectByName(hubName);
			const rim = hub?.getObjectByName(`cosmetic_rim_${hubName}`);
			rim?.removeFromParent();
		}
		const clone = cloneCarMesh(template);
		expect(clone.getObjectByName("wheel_FL")).toBeTruthy();
		let visibleTires = 0;
		for (const hubName of ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]) {
			const tire = clone.getObjectByName(`${hubName}_tire`);
			expect(tire).toBeTruthy();
			expect(tire?.visible).toBe(true);
			visibleTires++;
		}
		expect(visibleTires).toBe(4);
	});
});
