import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { AIManager } from "../../src/ai/AIManager";
import { BotLearning } from "../../src/ai/learning/BotLearning";
import { BotPolicy } from "../../src/ai/learning/BotPolicy";
import { buildRlKickoffSpawns } from "../../src/game/rlKickoffSpawns";
import {
	createTestScene,
	createTestCar,
	expectedHoverCenterY,
	simulateFrames,
	MockControlInput,
} from "../physics/harness";

describe("kickoff chase", () => {
	it("1v1 — bot z kickoffActive jedzie w piłkę mimo aktywnej sieci", () => {
		BotLearning.resetForTests();
		const learning = BotLearning.get();
		learning.loadPolicyData({
			...new BotPolicy(99).toData(),
			generation: 20,
			fitness: 50,
		});

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
		simulateFrames(scene, car, new MockControlInput(), 60);

		const ai = new AIManager();
		ai.registerBot(orange.slotIndex, orange.team);
		const ballPos = new THREE.Vector3(0, 0.92, 0);
		const ballVel = new THREE.Vector3(0, 0, 0);
		const startDist = car.getPosition().distanceTo(ballPos);
		let bestDist = startDist;
		let sawForward = false;
		let sawBoost = false;

		for (let i = 0; i < 300; i++) {
			const pos = car.getPosition();
			const ctx = {
				ballPos,
				ballVel,
				kickoffActive: true,
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
			const drive = ai.think(orange.slotIndex, car, ctx, null, 1 / 60);
			if (drive.forward > 0 || (drive.forwardAxis ?? 0) > 0.1) {
				sawForward = true;
			}
			if (drive.boost) sawBoost = true;

			scene.advancePhysics(
				1 / 60,
				(fixedDt, substep, substepCount) => {
					car.integrateHover(fixedDt, substep, substepCount);
				},
				(_fixedDt, substep, substepCount) => {
					car.finalizeHoverStep(substep, substepCount);
				},
			);
			car.afterPhysics(1 / 60);
			bestDist = Math.min(bestDist, car.getPosition().distanceTo(ballPos));
		}

		expect(sawForward).toBe(true);
		expect(startDist - bestDist).toBeGreaterThan(8);
		expect(bestDist).toBeLessThan(7);
	});
});
