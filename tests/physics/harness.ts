import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import RocketCar from "../../src/physics/RocketCar";
import Scene, { PHYSICS_FIXED_DT } from "../../src/Scene";
import type { ControlInput } from "../../src/util/ControlInput";
import { RL_CAR, RL_HOVER } from "../../src/util/rlConstants";

export const FRAME_DT = 1 / 60;
export const GROUND_HALF_Y = 0.1;

/** Syntetyczne wejście gracza — jednorazowy skok przez `queueJump()`. */
export class MockControlInput implements ControlInput {
	private forwardVal = 0;
	private yawVal = 0;
	private rollVal = 0;
	/** Liczba naciśnięć PPM w kolejce (jak GameInput.jumpEdgeCount). */
	private jumpQueued = 0;
	private jumpHeld = false;
	private boosting = false;
	private flipDir = false;
	private shiftDown = false;

	setBoosting(v: boolean): void {
		this.boosting = v;
	}

	setShift(v: boolean): void {
		this.shiftDown = v;
	}

	setForward(v: number): void {
		this.forwardVal = v;
		this.flipDir =
			Math.abs(this.forwardVal) > 0.2 || Math.abs(this.yawVal) > 0.2;
	}

	setYaw(v: number): void {
		this.yawVal = v;
		this.flipDir =
			Math.abs(this.forwardVal) > 0.2 || Math.abs(this.yawVal) > 0.2;
	}

	setRoll(v: number): void {
		this.rollVal = v;
	}

	queueJump(): void {
		this.jumpQueued = Math.min(3, this.jumpQueued + 1);
	}

	setJumpHeld(v: boolean): void {
		this.jumpHeld = v;
	}

	forward(): number {
		return this.forwardVal;
	}

	yaw(): number {
		return this.yawVal;
	}

	roll(): number {
		return this.rollVal;
	}

	isBoosting(): boolean {
		return this.boosting;
	}

	isShiftDown(): boolean {
		return this.shiftDown;
	}

	isJumpHeld(): boolean {
		return this.jumpHeld;
	}

	consumeRecover(): boolean {
		return false;
	}
	peekJump(): boolean {
		return this.jumpQueued > 0;
	}

	consumeJump(): boolean {
		if (this.jumpQueued <= 0) return false;
		this.jumpQueued--;
		return true;
	}

	hasFlipDirection(): boolean {
		return this.flipDir;
	}
}

export function createTestScene(): Scene {
	const scene = new Scene();
	const groundRb = scene.rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	scene.rapierWorld.createCollider(
		RAPIER.ColliderDesc.cuboid(45, GROUND_HALF_Y, 62),
		groundRb,
	);
	return scene;
}

/** Pionowa ściana arena — normalna skierowana w stronę auta (ujemne X). */
export function createWallTestScene(wallX = 12): Scene {
	const scene = createTestScene();
	const wallRb = scene.rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	scene.rapierWorld.createCollider(
		RAPIER.ColliderDesc.cuboid(0.5, 8, 20)
			.setTranslation(wallX, 8, 0)
			.setFriction(0.92)
			.setRestitution(0.48),
		wallRb,
	);
	return scene;
}

/** Rampa 45° — wjazd od −X w stronę środka areny. */
export function createRampTestScene(rampCenterX = 10): Scene {
	const scene = createTestScene();
	const rampRb = scene.rapierWorld.createRigidBody(
		RAPIER.RigidBodyDesc.fixed().setRotation(
			new RAPIER.Quaternion(
				0,
				Math.sin(Math.PI / 8),
				0,
				Math.cos(Math.PI / 8),
			),
		),
	);
	scene.rapierWorld.createCollider(
		RAPIER.ColliderDesc.cuboid(6, 0.25, 12)
			.setTranslation(rampCenterX, 3.5, 0)
			.setFriction(0.92)
			.setRestitution(0.48),
		rampRb,
	);
	return scene;
}

export function createTestCar(scene: Scene): RocketCar {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
	return new RocketCar(scene, mesh);
}

/** Oczekiwana wysokość środka auta nad podłogą w stanie hover. */
export function expectedHoverCenterY(): number {
	return GROUND_HALF_Y + RL_HOVER.suspensionRestLength + RL_CAR.hitboxHalfY;
}

/**
 * Symuluje klatki gry: control @ 60 Hz → integrateHover @ 120 Hz (sub-step) → Rapier.
 * Odpowiednik pętli z GameSession (bez renderu).
 */
export function simulateFrames(
	scene: Scene,
	car: RocketCar,
	input: MockControlInput,
	frames: number,
	frameDt = FRAME_DT,
): void {
	for (let i = 0; i < frames; i++) {
		car.control(input, frameDt);
		scene.advancePhysics(
			frameDt,
			(fixedDt, substep, substepCount) => {
				car.integrateHover(fixedDt, substep, substepCount);
			},
			(_fixedDt, substep, substepCount) => {
				car.finalizeHoverStep(substep, substepCount);
			},
		);
		car.afterPhysics(frameDt);
	}
}

/** Prędkość wzdłuż lokalnej osi +Z auta. */
export function localForwardSpeed(car: RocketCar): number {
	const fwd = car.getForward().normalize();
	return car.getVelocity().dot(fwd);
}

/** Składowa prędkości kątowej wokół lokalnej osi X (pitch). */
export function localPitchRate(car: RocketCar): number {
	const right = car.getSideward().normalize();
	const av = car.rapierRigidBody.angvel();
	return av.x * right.x + av.y * right.y + av.z * right.z;
}

/** Składowa prędkości kątowej wokół lokalnej osi Z (roll). */
export function localRollRate(car: RocketCar): number {
	const fwd = car.getForward().normalize();
	const av = car.rapierRigidBody.angvel();
	return av.x * fwd.x + av.y * fwd.y + av.z * fwd.z;
}

/** Składowa prędkości kątowej wokół lokalnej osi Y (yaw). */
export function localYawRate(car: RocketCar): number {
	const up = car.getUpward().normalize();
	const av = car.rapierRigidBody.angvel();
	return av.x * up.x + av.y * up.y + av.z * up.z;
}

export { PHYSICS_FIXED_DT };
