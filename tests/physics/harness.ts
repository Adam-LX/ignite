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
	private jumpQueued = false;
	private jumpHeld = false;
	private boosting = false;
	private flipDir = false;

	setBoosting(v: boolean): void {
		this.boosting = v;
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

	queueJump(): void {
		this.jumpQueued = true;
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
		return 0;
	}

	isBoosting(): boolean {
		return this.boosting;
	}

	isShiftDown(): boolean {
		return false;
	}

	isJumpHeld(): boolean {
		return this.jumpHeld;
	}

	consumeRecover(): boolean {
		return false;
	}
	peekJump(): boolean {
		return this.jumpQueued;
	}

	consumeJump(): boolean {
		if (!this.jumpQueued) return false;
		this.jumpQueued = false;
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

export function createTestCar(scene: Scene): RocketCar {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
	return new RocketCar(scene, mesh);
}

/** Oczekiwana wysokość środka auta nad podłogą w stanie hover. */
export function expectedHoverCenterY(): number {
	return GROUND_HALF_Y + RL_HOVER.suspensionRestLength + RL_CAR.hitboxHalfY;
}

/**
 * Symuluje klatki gry: control @ 60 Hz → integrateHover @ 120 Hz → Rapier step.
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
			(fixedDt) => {
				car.integrateHover(fixedDt);
			},
			() => {
				car.finalizeHoverStep();
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

export { PHYSICS_FIXED_DT };
