import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { MatchController } from "../../src/modes/MatchController";
import Scene from "../../src/Scene";
import { buildArenaPhysics } from "../../src/visual/arena";
import {
	createTestCar,
	localForwardSpeed,
	MockControlInput,
	simulateFrames,
} from "../physics/harness";

vi.mock("../../src/debug/config", () => ({
	HOVER_SAFE_MODE: true,
	HOVER_DEBUG_RAYS: false,
	HOVER_FORCE_MAX: 50_000,
	HOVER_TELEMETRY_EVERY_STEPS: 0,
	DEBUG_AUTOPILOT: false,
	AUTOPILOT_DURATION_SEC: 20,
}));

const FRAME_DT = 1 / 60;
const CAR_HALF_HEIGHT = 0.35;

function runKickoffToPlaying(match: MatchController): void {
	let elapsed = 0;
	while (match.isKickoffCountdownActive() && elapsed < 12) {
		match.advanceCountdown(FRAME_DT);
		elapsed += FRAME_DT;
	}
}

describe("Kickoff → jazda na arenie", () => {
	it("auto ląduje i jedzie do przodu po phase=playing", () => {
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
		expect(car.isOnGround()).toBe(true);

		runKickoffToPlaying(match);
		expect(match.getHudSnapshot([]).phase).toBe("playing");
		expect(match.isCarsFrozen()).toBe(false);

		input.setForward(1);
		simulateFrames(scene, car, input, 90);

		expect(localForwardSpeed(car)).toBeGreaterThan(2);
	});

	it("auto jedzie podczas IGNITE (przed phase=playing)", () => {
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

		let elapsed = 0;
		while (elapsed < 12) {
			match.advanceCountdown(FRAME_DT);
			elapsed += FRAME_DT;
			if (match.getHudSnapshot([]).kickoffIgnite) break;
		}

		expect(match.getHudSnapshot([]).kickoffIgnite).toBe(true);
		expect(match.isCarsFrozen()).toBe(false);

		input.setForward(1);
		simulateFrames(scene, car, input, 45);

		expect(localForwardSpeed(car)).toBeGreaterThan(1.5);
	});
});
