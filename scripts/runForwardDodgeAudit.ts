/**
 * Audyt bocznego dryfu przy frontflip (2nd PPM + W).
 * npx vite-node scripts/runForwardDodgeAudit.ts
 */
import RAPIER from "@dimforge/rapier3d-compat";

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

function frontflipScenario(
	label: string,
	opts: {
		speedZ: number;
		yawAt2: number;
		yawDuring1?: number;
		holdWThroughFlip?: boolean;
	},
): void {
	const scene = createTestScene();
	const car = createTestCar(scene);
	const input = new MockControlInput();
	car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
	car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: opts.speedZ }, true);
	for (let i = 0; i < 90; i++) simulateFrame(scene, car, input);

	if (opts.yawDuring1) input.setYaw(opts.yawDuring1);
	input.setForward(1);
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrame(scene, car, input);
	input.setJumpHeld(false);
	input.setYaw(0);
	for (let i = 0; i < 14; i++) simulateFrame(scene, car, input);

	input.setForward(1);
	input.setYaw(opts.yawAt2);
	input.queueJump();
	simulateFrame(scene, car, input);

	if (!opts.holdWThroughFlip) {
		input.setForward(0);
		input.setYaw(0);
	}

	let maxAbsVx = 0;
	let maxAbsX = 0;
	for (let i = 0; i < 25; i++) {
		simulateFrame(scene, car, input);
		const v = car.getVelocity();
		const p = car.getPosition();
		maxAbsVx = Math.max(maxAbsVx, Math.abs(v.x));
		maxAbsX = Math.max(maxAbsX, Math.abs(p.x));
	}

	console.log(
		`${label.padEnd(42)} flip=${car.isFlipping() ? 1 : 0} max|vx|=${maxAbsVx.toFixed(2)} max|x|=${maxAbsX.toFixed(2)}`,
	);
}

async function main(): Promise<void> {
	await RAPIER.init();
	console.log("=== Forward dodge lateral drift audit ===\n");
	frontflipScenario("LOW  W only", { speedZ: 0, yawAt2: 0 });
	frontflipScenario("LOW  W + ghost yaw 0.12", { speedZ: 0, yawAt2: 0.12 });
	frontflipScenario("LOW  W + ghost yaw 0.15", { speedZ: 0, yawAt2: 0.15 });
	frontflipScenario("LOW  W + ghost yaw 0.18", { speedZ: 0, yawAt2: 0.18 });
	frontflipScenario("HIGH W only", { speedZ: 12, yawAt2: 0 });
	frontflipScenario("HIGH W + ghost yaw 0.15", { speedZ: 12, yawAt2: 0.15 });
	frontflipScenario("LOW  W held through flip", {
		speedZ: 0,
		yawAt2: 0,
		holdWThroughFlip: true,
	});
	frontflipScenario("HIGH W held through flip", {
		speedZ: 12,
		yawAt2: 0,
		holdWThroughFlip: true,
	});
}

main();
