/**
 * Diagnostyka pełnego obrotu flipa — vite-node scripts/probeFlip360.ts
 */
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

import RocketCar from "../src/physics/RocketCar";
import {
	createTestCar,
	createTestScene,
	MockControlInput,
	simulateFrames,
} from "../tests/physics/harness";

function pitchDeg(car: RocketCar): number {
	const r = car.rapierRigidBody.rotation();
	const e = new THREE.Euler().setFromQuaternion(
		new THREE.Quaternion(r.x, r.y, r.z, r.w),
		"YXZ",
	);
	return THREE.MathUtils.radToDeg(e.x);
}

function jumpSecond(
	scene: ReturnType<typeof createTestScene>,
	car: RocketCar,
	input: MockControlInput,
	fwd: number,
	gap: number,
): void {
	input.setForward(fwd);
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
	input.setJumpHeld(false);
	simulateFrames(scene, car, input, gap);
	input.setForward(fwd);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
}

function runCase(
	scene: ReturnType<typeof createTestScene>,
	car: RocketCar,
	input: MockControlInput,
	name: string,
	fwd: number,
	gap: number,
): void {
	input.setForward(fwd);
	simulateFrames(scene, car, input, 25);

	const fwd0 = car.getForward().clone();
	fwd0.y = 0;
	fwd0.normalize();

	jumpSecond(scene, car, input, fwd, gap);
	const flipStart = car.isFlipping();
	input.setForward(fwd);

	let minP = 999;
	let maxP = -999;
	let flipEndFrame = -1;
	let maxFy = 0;
	for (let i = 0; i < 100; i++) {
		if (i > 0 && !car.isFlipping() && flipEndFrame < 0) flipEndFrame = i;
		simulateFrames(scene, car, input, 1);
		const p = pitchDeg(car);
		minP = Math.min(minP, p);
		maxP = Math.max(maxP, p);
		maxFy = Math.max(maxFy, Math.abs(car.getForward().y));
	}
	const fwd1 = car.getForward().clone();
	fwd1.y = 0;
	if (fwd1.lengthSq() > 1e-6) fwd1.normalize();
	console.log(
		`${name} flipStart=${flipStart} pitch[${minP.toFixed(0)},${maxP.toFixed(0)}] max|fy|=${maxFy.toFixed(2)} flipEnd@${flipEndFrame} uy=${car.getUpward().y.toFixed(2)} fwdDot=${fwd0.dot(fwd1).toFixed(2)}`,
	);
}

async function main(): Promise<void> {
	await RAPIER.init();
	const scene = createTestScene();
	const car = createTestCar(scene);
	const input = new MockControlInput();

	runCase(scene, car, input, "front gap8", 1, 8);
	runCase(scene, car, input, "front gap16", 1, 16);
	runCase(scene, car, input, "back gap8", -1, 8);
	runCase(scene, car, input, "back gap16", -1, 16);

	input.setForward(1);
	simulateFrames(scene, car, input, 20);
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
	input.setForward(1);
	simulateFrames(scene, car, input, 40);
	console.log(
		`single-edge W hold: flipping=${car.isFlipping()} fy=${car.getForward().y.toFixed(2)} pitch=${pitchDeg(car).toFixed(0)} uy=${car.getUpward().y.toFixed(2)}`,
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
