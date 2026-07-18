import type * as THREE from "three";

/** Bez kolorowych plam na murawie — usuń legacy underglow z aut. */
export function mountCarNeonUnderglow(car: THREE.Group): void {
	car.updateMatrixWorld(true);
	for (const name of [
		"underglowLight",
		"underglowTarget",
		"underglowDisc",
		"underglowRim",
	]) {
		const obj = car.getObjectByName(name);
		obj?.parent?.remove(obj);
	}
}

/** @deprecated Underglow wyłączony — brak markera na murawie. */
export function attachCarUnderglowLight(
	parent: THREE.Object3D,
): THREE.SpotLight | null {
	for (const name of ["underglowLight", "underglowTarget"]) {
		const obj = parent.getObjectByName(name);
		obj?.parent?.remove(obj);
	}
	return null;
}
