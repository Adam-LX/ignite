import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { applyLearnedTargetOffset } from "../../src/ai/learning/BotLearnedTargeting";
import { deriveTuning } from "../../src/ai/learning/BotLearningTuning";
import { POLICY_OUTPUT_SIZE } from "../../src/ai/learning/BotPolicy";

describe("BotLearnedTargeting", () => {
	it("przesuwa cel w bok i w górę przy aerial", () => {
		const target = new THREE.Vector3(0, 0, 0);
		const outputs = new Float32Array(POLICY_OUTPUT_SIZE);
		outputs[6] = 0.8;
		outputs[7] = 0.7;
		outputs[8] = 0.5;
		outputs[10] = 0.6;
		outputs[11] = 1.2;
		const tuning = deriveTuning(outputs, 10, 40, true);

		applyLearnedTargetOffset(
			target,
			{
				ballPos: new THREE.Vector3(0, 2.5, 10),
				ballVel: new THREE.Vector3(0, 0, 8),
				botPos: new THREE.Vector3(0, 1, 0),
				enemyGoal: new THREE.Vector3(0, 0, 40),
				fsmState: "AERIAL",
			},
			tuning,
		);

		expect(target.y).toBeGreaterThan(1.5);
		expect(target.distanceTo(new THREE.Vector3(0, 0, 0))).toBeGreaterThan(2);
	});
});
