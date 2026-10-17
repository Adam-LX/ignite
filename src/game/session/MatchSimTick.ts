import type * as THREE from "three";
import type GameObject from "../../GameObject";
import type Renderer from "../../Renderer";
import { stabilizePlayerPhysics } from "../../util/rlContacts";
import type { BallOffScreenIndicator } from "../../ui/BallOffScreenIndicator";
import type { BallFloorIndicator } from "../../visual/ballTracking/BallFloorIndicator";
import type { BallShadow } from "../../visual/ballShadow";
import { updateBallMaterialView } from "../../visual/materials";
import type { BallVfx } from "../../visual/vfx/ballVfx";
import type { BallWallMarkVfx } from "../../visual/vfx/ballWallMark";
import type { HitVfx } from "../../visual/vfx/hitVfx";
import type { PowerUpActivationVfx } from "../../visual/vfx/powerUpActivationVfx";
import type { CarEntity } from "../CarEntity";

export type BallTrackingDeps = {
	ball: GameObject;
	ballShadow: BallShadow;
	ballFloorIndicator: BallFloorIndicator;
	ballOffScreen: BallOffScreenIndicator;
	ballVfx: BallVfx;
	hitVfx: HitVfx;
	powerUpActivationVfx: PowerUpActivationVfx;
	ballWallMarkVfx: BallWallMarkVfx;
	renderer: Renderer;
};

/** Ball shadow / VFX / off-screen indicator after sim step. */
export function updateMatchBallTracking(
	deps: BallTrackingDeps,
	dt: number,
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
): void {
	deps.ballShadow.update(ballPos);
	deps.ballFloorIndicator.update(ballPos, ballVel);
	updateBallMaterialView(deps.renderer.threeJSCamera, dt);
	deps.ballVfx.update(deps.ball, dt);
	deps.hitVfx.update(dt);
	deps.powerUpActivationVfx.update(dt);
	deps.ballWallMarkVfx.updateBallProximity(ballPos, ballVel, dt);
	deps.ballOffScreen.update(
		ballPos,
		deps.renderer.threeJSCamera,
		deps.renderer.isBallCamEnabled(),
		dt,
	);
}

/** Per-car afterPhysics + stabilize (shared host / guest / replay paths). */
export function stabilizeMatchCars(cars: CarEntity[], simDt: number): void {
	for (const car of cars) {
		car.player.afterPhysics(simDt);
		stabilizePlayerPhysics(car.player);
	}
}

export type LandingPulse = { car: CarEntity; landing: number };

export function collectLandingPulses(cars: CarEntity[]): LandingPulse[] {
	const out: LandingPulse[] = [];
	for (const car of cars) {
		const landing = car.player.consumeLandingPulse();
		if (landing > 0) out.push({ car, landing });
	}
	return out;
}

/** Read ball linvel into a scratch vector. */
export function readBallVelocity(
	ball: GameObject,
	out: THREE.Vector3,
): THREE.Vector3 {
	const v = ball.rapierRigidBody.linvel();
	return out.set(v.x, v.y, v.z);
}
