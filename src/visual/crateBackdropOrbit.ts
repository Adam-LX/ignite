import * as THREE from "three";

import { horizontalFovToVertical } from "./cameraFollow";

/** Kinowa orbita boiska pod ekranem dropu — ten sam język co menu. */
const ORBIT_RADIUS = 54;
const BASE_HEIGHT = 18.5;
const HEIGHT_WAVE = 2.8;
const ORBIT_SPEED = 0.14;
const LOOK_TARGET = new THREE.Vector3(0, 2.4, 0);
const MENU_HORIZONTAL_FOV = 54;

/**
 * Orbita kamery za półprzezroczystym tłem dropu.
 * Używana w meczu (po finished) — w menu wystarczy LiveMainMenuScene.
 */
export class CrateBackdropOrbit {
	private time = Math.random() * Math.PI * 2;

	update(camera: THREE.PerspectiveCamera, dt: number): void {
		this.time += dt * ORBIT_SPEED;
		const x = Math.cos(this.time) * ORBIT_RADIUS;
		const z = Math.sin(this.time) * ORBIT_RADIUS;
		const y = BASE_HEIGHT + Math.sin(this.time * 0.85) * HEIGHT_WAVE;
		camera.position.set(x, y, z);
		camera.up.set(0, 1, 0);
		camera.lookAt(LOOK_TARGET);
		const fov = horizontalFovToVertical(MENU_HORIZONTAL_FOV, camera.aspect);
		if (Math.abs(camera.fov - fov) > 0.08) {
			camera.fov = fov;
			camera.updateProjectionMatrix();
		}
	}
}
