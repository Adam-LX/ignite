import * as THREE from "three";

import { CAR_NEON_CYAN } from "./carPanelMaterial";

/** Szeroki stożek w dół — podświetla murawę, nie wypala karoserii z góry. */
export function attachCarUnderglowLight(
	parent: THREE.Object3D,
	heightY = 0.06,
): THREE.SpotLight {
	let light = parent.getObjectByName("underglowLight") as
		| THREE.SpotLight
		| undefined;
	if (!light) {
		light = new THREE.SpotLight(CAR_NEON_CYAN, 2.4, 7, Math.PI / 2.4, 0.55, 2);
		light.name = "underglowLight";
		light.castShadow = false;
		parent.add(light);

		const target = new THREE.Object3D();
		target.name = "underglowTarget";
		parent.add(target);
		light.target = target;
	}

	light.position.set(0, heightY, 0);
	light.target.position.set(0, -1.2, 0);
	return light;
}

/** Cyan underglow skierowany w dół (bez neonowej „siatki” pod autem). */
export function mountCarNeonUnderglow(car: THREE.Group): void {
	car.updateMatrixWorld(true);
	attachCarUnderglowLight(car);
}
