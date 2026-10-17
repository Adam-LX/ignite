/**
 * One-shot dodge orientation dump (vite-node).
 */
import * as THREE from "three";
import {
	createTestCar,
	createTestScene,
	MockControlInput,
	simulateFrames,
	localPitchRate,
	localRollRate,
	localYawRate,
} from "../tests/physics/harness.ts";

function dumpFlip(label, dir) {
	const scene = createTestScene();
	const car = createTestCar(scene);
	const input = new MockControlInput();
	car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
	simulateFrames(scene, car, input, 90);

	if (dir.forward) input.setForward(dir.forward);
	if (dir.yaw) input.setYaw(dir.yaw);
	simulateFrames(scene, car, input, 20);

	input.setJumpHeld(true);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
	input.setJumpHeld(false);
	input.setForward(0);
	input.setYaw(0);
	simulateFrames(scene, car, input, 16);
	if (dir.forward) input.setForward(dir.forward);
	if (dir.yaw) input.setYaw(dir.yaw);
	input.queueJump();
	simulateFrames(scene, car, input, 1);

	console.log("\n===", label, "===");
	for (let i = 0; i < 45; i++) {
		simulateFrames(scene, car, input, 1);
		const up = car.getUpward();
		const fwd = car.getForward();
		const right = car.getSideward();
		const av = car.rapierRigidBody.angvel();
		const avLen = Math.hypot(av.x, av.y, av.z);
		console.log(
			`t=${((i + 1) / 60).toFixed(2)} flip=${car.isFlipping() ? 1 : 0} ` +
				`upY=${up.y.toFixed(2)} fwdY=${fwd.y.toFixed(2)} rightY=${right.y.toFixed(2)} ` +
				`p=${localPitchRate(car).toFixed(2)} r=${localRollRate(car).toFixed(2)} y=${localYawRate(car).toFixed(2)} |ω|=${avLen.toFixed(2)}`,
		);
		if (!car.isFlipping() && i > 8) break;
	}
}

dumpFlip("FRONT W", { forward: 1 });
dumpFlip("SIDE A", { yaw: 1 });
dumpFlip("BACK S", { forward: -1 });
