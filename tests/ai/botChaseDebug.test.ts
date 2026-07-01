import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { AIManager } from "../../src/ai/AIManager";
import { BotBehavior } from "../../src/ai/BotBehavior";
import { buildRlKickoffSpawns } from "../../src/game/rlKickoffSpawns";
import {
	createTestScene,
	createTestCar,
	expectedHoverCenterY,
	simulateFrames,
	MockControlInput,
} from "../physics/harness";

describe("bot chase — RL spawn", () => {
	it("1v1 orange zbliża się do leżącej piłki", () => {
		const scene = createTestScene();
		const spawns = buildRlKickoffSpawns("1v1", expectedHoverCenterY());
		const orange = spawns.find((s) => s.team === "orange")!;
		const car = createTestCar(scene);
		car.resetKickoffPose(
			orange.position.x,
			orange.position.y,
			orange.position.z,
			orange.yaw,
		);
		simulateFrames(scene, car, new MockControlInput(), 90);

		const ai = new AIManager();
		ai.registerBot(orange.slotIndex, orange.team);
		const ballPos = new THREE.Vector3(0, 0.5, 0);
		const ballVel = new THREE.Vector3(0, 0, 0);
		const start = car.getPosition().clone();
		const startDist = start.distanceTo(ballPos);
		let drive0 = { forward: 0, yaw: 0, boost: false };
		let bestDist = startDist;

		for (let i = 0; i < 240; i++) {
			const pos = car.getPosition();
			const ctx = {
				ballPos,
				ballVel,
				kickoffActive: false,
				kickoffCountdown: false,
				kickoffDriveLocked: false,
				carsFrozen: false,
				isFFA: false,
				teamSize: 1,
				peers: [
					{
						slotIndex: 0,
						team: "blue" as const,
						position: new THREE.Vector3(0, 0, -30),
						isHuman: true,
					},
					{
						slotIndex: orange.slotIndex,
						team: "orange" as const,
						position: pos.clone(),
						isHuman: false,
					},
				],
			};
			ai.beginFrame(ctx, 1 / 60);
			if (i === 0) {
				drive0 = ai.think(orange.slotIndex, car, ctx, null, 1 / 60);
			} else {
				ai.think(orange.slotIndex, car, ctx, null, 1 / 60);
			}
			scene.advancePhysics(
				1 / 60,
				(fixedDt) => {
					car.integrateHover(fixedDt);
				},
				() => {
					car.finalizeHoverStep();
				},
			);
			car.afterPhysics(1 / 60);
			bestDist = Math.min(bestDist, car.getPosition().distanceTo(ballPos));
		}

		expect(drive0.forward).toBeGreaterThan(0);
		expect(startDist - bestDist).toBeGreaterThan(6);
	});

	it("goalie z farBack jedzie po leżącą piłkę", () => {
		const spawns = buildRlKickoffSpawns("2v2", expectedHoverCenterY());
		const farBack = spawns.find(
			(s) => s.team === "orange" && s.spawnRole === "center_back",
		)!;
		const behavior = new BotBehavior("orange", farBack.slotIndex);
		const ballPos = new THREE.Vector3(0, 0.5, 0);
		const ballVel = new THREE.Vector3(0, 0, 0);
		const botPos = farBack.position.clone();

		const fsm = behavior["evaluateFsm"](
			{
				getSurfaceNormal: () => new THREE.Vector3(0, 1, 0),
				getUpward: () => new THREE.Vector3(0, 1, 0),
				isOnWallOrRamp: () => false,
			} as never,
			"goalie",
			{
				ballPos,
				ballVel,
				intercept: ballPos,
				kickoffActive: false,
				kickoffCountdown: false,
				kickoffDriveLocked: false,
				carsFrozen: false,
				isFFA: false,
				teamSize: 2,
				peers: [],
			},
			botPos,
			new THREE.Vector3(0, 0, -60),
			{
				interceptLead: 1,
				boostDistanceMul: 1,
				challengeRadiusMul: 1,
				aggression: 1,
				boostBias: 0,
				defenseBias: 0,
				aerialBias: 0.35,
			},
		);

		expect(fsm).toBe("ALIGN_SHOT");
	});
});
