import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { MatchController } from "../../src/modes/MatchController";
import Scene from "../../src/Scene";
import { buildArenaPhysics } from "../../src/visual/arena";
import {
	createTestCar,
	localForwardSpeed,
	MockControlInput,
	simulateFrames,
} from "../physics/harness";

const FRAME_DT = 1 / 60;
const CAR_HALF_HEIGHT = 0.35;

export type KickoffDriveSelfTestResult = {
	passed: boolean;
	phase: string;
	speedMps: number;
	errors: string[];
};

/** Headless: kickoff → playing → throttle na prawdziwej arenie. */
export async function runKickoffDriveSelfTest(): Promise<KickoffDriveSelfTestResult> {
	await RAPIER.init();

	const errors: string[] = [];
	const scene = new Scene();
	buildArenaPhysics(scene.rapierWorld);

	const match = new MatchController(scene.threeJSScene, "1v1");
	const spawns = match.initSpawns(CAR_HALF_HEIGHT);
	const spawn = spawns[0]!;

	const car = createTestCar(scene);
	car.resetKickoffPose(
		spawn.position.x,
		spawn.position.y,
		spawn.position.z,
		spawn.yaw,
	);

	const input = new MockControlInput();
	simulateFrames(scene, car, input, 150);

	if (!car.isOnGround()) {
		errors.push("auto nie wylądowało na boisku");
	}

	let elapsed = 0;
	while (match.isKickoffCountdownActive() && elapsed < 12) {
		match.advanceCountdown(FRAME_DT);
		elapsed += FRAME_DT;
	}

	const snap = match.getHudSnapshot([]);
	if (snap.phase !== "playing") {
		errors.push(`phase=${snap.phase} (oczekiwano playing)`);
	}
	if (match.isCarsFrozen()) {
		errors.push("carsFrozen=true po kickoff");
	}

	input.setForward(1);
	simulateFrames(scene, car, input, 90);

	const speed = localForwardSpeed(car);
	if (speed < 2) {
		errors.push(`speed=${speed.toFixed(2)} m/s (oczekiwano >2)`);
	}

	return {
		passed: errors.length === 0,
		phase: snap.phase,
		speedMps: speed,
		errors,
	};
}
