import * as THREE from "three";

const ORBIT_RADIUS = 24;
const BASE_HEIGHT = 4.2;
const HEIGHT_WAVE = 2.2;
const ORBIT_SPEED = 0.28;
const LOOK_TARGET = new THREE.Vector3(0, 1.8, 0);

const _lookScratch = new THREE.Vector3();

/**
 * Kinowa orbita menu — niska, szybka, z lekkim roll-em przy zbliżeniu.
 */
export class MenuCinematicCamera {
	private menuTime = 0;
	private readonly position = new THREE.Vector3();
	private readonly lookAt = new THREE.Vector3();

	update(camera: THREE.PerspectiveCamera, delta: number): void {
		this.menuTime += delta * ORBIT_SPEED;

		const height = BASE_HEIGHT + Math.sin(this.menuTime * 2.1) * HEIGHT_WAVE;
		const radius = ORBIT_RADIUS + Math.sin(this.menuTime * 0.85) * 3.5;
		this.position.set(
			Math.cos(this.menuTime) * radius,
			height,
			Math.sin(this.menuTime) * radius,
		);

		this.lookAt.copy(LOOK_TARGET);
		this.lookAt.x += Math.sin(this.menuTime * 1.1) * 2.4;
		this.lookAt.y += Math.sin(this.menuTime * 1.6) * 0.35;
		this.lookAt.z += Math.cos(this.menuTime * 0.9) * 2.4;

		camera.position.copy(this.position);
		camera.up.set(0, 1, 0);
		camera.lookAt(this.lookAt);

		const roll = Math.sin(this.menuTime * 0.55) * 0.018;
		camera.rotateZ(roll);
	}

	getPose(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
		_lookScratch.copy(this.lookAt);
		return {
			position: this.position.clone(),
			lookAt: _lookScratch.clone(),
		};
	}

	reset(): void {
		this.menuTime = 0;
	}
}
