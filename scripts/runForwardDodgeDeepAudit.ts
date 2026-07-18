/**
 * Slip kątowy prędkości vs auto po frontflip.
 * npx vite-node scripts/runForwardDodgeDeepAudit.ts
 */
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import RocketCar from "../src/physics/RocketCar";
import Scene from "../src/Scene";
import {
	createTestCar,
	createTestScene,
	FRAME_DT,
	MockControlInput,
} from "../tests/physics/harness";

function simulateFrame(
	scene: Scene,
	car: RocketCar,
	input: MockControlInput,
): void {
	car.control(input, FRAME_DT);
	scene.advancePhysics(
		FRAME_DT,
		(dt, substep, substepCount) => car.integrateHover(dt, substep, substepCount),
		(_dt, substep, substepCount) => car.finalizeHoverStep(substep, substepCount),
	);
	car.afterPhysics(FRAME_DT);
}

function eulerY(car: RocketCar): number {
	const r = car.rapierRigidBody.rotation();
	const e = new THREE.Euler().setFromQuaternion(
		new THREE.Quaternion(r.x, r.y, r.z, r.w),
		"YXZ",
	);
	return e.y;
}

function eulerX(car: RocketCar): number {
	const r = car.rapierRigidBody.rotation();
	const e = new THREE.Euler().setFromQuaternion(
		new THREE.Quaternion(r.x, r.y, r.z, r.w),
		"YXZ",
	);
	return e.x;
}

/** Kąt między prędkością XZ a nosem auta (°). */
function velocitySlipDeg(car: RocketCar): number {
	const vel = car.getVelocity();
	if (Math.hypot(vel.x, vel.z) < 0.2) return 0;
	const r = car.rapierRigidBody.rotation();
	const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
		new THREE.Quaternion(r.x, r.y, r.z, r.w),
	);
	const velA = Math.atan2(vel.x, vel.z);
	const fwdA = Math.atan2(fwd.x, fwd.z);
	let d = ((velA - fwdA) * 180) / Math.PI;
	while (d > 180) d -= 360;
	while (d < -180) d += 360;
	return d;
}

function jumpThenFrontflip(
	label: string,
	opts: { wJump1: boolean; wJump2: boolean; holdW: boolean; speedZ: number },
): void {
	const scene = createTestScene();
	const car = createTestCar(scene);
	const input = new MockControlInput();
	car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
	car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: opts.speedZ }, true);
	for (let i = 0; i < 90; i++) simulateFrame(scene, car, input);

	if (opts.wJump1) input.setForward(1);
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrame(scene, car, input);
	input.setJumpHeld(false);
	if (opts.wJump1 && !opts.holdW) input.setForward(0);
	for (let i = 0; i < 14; i++) simulateFrame(scene, car, input);

	const pitchBefore = (eulerX(car) * 180) / Math.PI;
	const yawBefore = (eulerY(car) * 180) / Math.PI;

	if (opts.wJump2) input.setForward(1);
	input.queueJump();
	simulateFrame(scene, car, input);
	if (!opts.holdW) input.setForward(0);

	let maxSlip = 0;
	let maxYawDelta = 0;
	const yaw0 = eulerY(car);
	for (let i = 0; i < 35; i++) {
		simulateFrame(scene, car, input);
		maxSlip = Math.max(maxSlip, Math.abs(velocitySlipDeg(car)));
		maxYawDelta = Math.max(
			maxYawDelta,
			Math.abs(((eulerY(car) - yaw0) * 180) / Math.PI),
		);
	}

	console.log(
		`${label.padEnd(38)} pitch₀=${pitchBefore.toFixed(1)}° slip=${maxSlip.toFixed(1)}° yawΔ=${maxYawDelta.toFixed(1)}° |vx|=${Math.abs(car.getVelocity().x).toFixed(2)}`,
	);
}

async function main(): Promise<void> {
	await RAPIER.init();
	console.log("=== Frontflip: slip prędkości vs yaw auta ===\n");
	jumpThenFrontflip("W jump1 + W dodge (hold)", {
		wJump1: true,
		wJump2: true,
		holdW: true,
		speedZ: 0,
	});
	jumpThenFrontflip("W jump1, W tap dodge", {
		wJump1: true,
		wJump2: true,
		holdW: false,
		speedZ: 0,
	});
	jumpThenFrontflip("neutral jump1, W dodge", {
		wJump1: false,
		wJump2: true,
		holdW: false,
		speedZ: 0,
	});
	jumpThenFrontflip("W jump1, W dodge @12m/s", {
		wJump1: true,
		wJump2: true,
		holdW: true,
		speedZ: 12,
	});
	jumpThenFrontflip("drive W 30f, jump, dodge", {
		wJump1: true,
		wJump2: true,
		holdW: true,
		speedZ: 0,
	});
}

main();
