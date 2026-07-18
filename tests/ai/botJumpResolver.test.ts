import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
	isJumpSituationAllowed,
	policySigmoid,
	resolveJumpDecision,
	type JumpGateContext,
} from "../../src/ai/learning/BotJumpResolver";
import { deriveTuning, resolveLearnedDrive } from "../../src/ai/learning/BotLearningTuning";
import { POLICY_OUTPUT_SIZE } from "../../src/ai/learning/BotPolicy";

function fullOutputs(values: number[]): Float32Array {
	const out = new Float32Array(POLICY_OUTPUT_SIZE);
	for (let i = 0; i < Math.min(values.length, POLICY_OUTPUT_SIZE); i++) {
		out[i] = values[i]!;
	}
	return out;
}

function groundGate(overrides: Partial<JumpGateContext> = {}): JumpGateContext {
	return {
		forceRecovery: false,
		forcedJump: false,
		inAir: false,
		onGround: true,
		ballAirborne: false,
		ballAboveBot: false,
		ballY: 0.45,
		horizDist: 3,
		defending: false,
		looseBall: true,
		goalieOrClearance: false,
		...overrides,
	};
}

describe("BotJumpResolver", () => {
	it("blokuje skok do piłki na ziemi przy niskiej autonomii", () => {
		const ctx = groundGate();
		expect(isJumpSituationAllowed(ctx, 0)).toBe(false);
		expect(
			resolveJumpDecision(
				true,
				0.9,
				deriveTuning(fullOutputs([0, 0, 0, 0]), 5, 10, true),
				0.8,
				ctx,
				0.2,
			),
		).toBe(false);
	});

	it("sieć może zainicjować skok przy wysokiej autonomii", () => {
		const ctx = groundGate({
			looseBall: false,
			ballAirborne: true,
			ballAboveBot: true,
			ballY: 2.4,
		});
		const tuning = deriveTuning(
			fullOutputs([0.2, 0.7, 0.5, 0.85, 0, 0, 0, 0, 0, 0, 0, 2]),
			12,
			30,
			true,
		);
		expect(
			resolveJumpDecision(false, 1.2, tuning, 0.75, ctx, tuning.policyAutonomy),
		).toBe(true);
	});

	it("resolveLearnedDrive — boost przy aerial gdy skok zaakceptowany", () => {
		const outputs = fullOutputs([0.5, 0.9, 0.85, 0.7, 0, 0, 0, 0, 0, 0, 0, 1]);
		const tuning = deriveTuning(outputs, 10, 50, true);
		const jumpGate = groundGate({
			looseBall: false,
			ballAirborne: true,
			ballAboveBot: true,
			ballY: 2.5,
		});
		const drive = resolveLearnedDrive(
			{ forward: 1, yaw: 0, boost: false, jump: false },
			{
				policyOutputs: outputs,
				tuning,
				maturity: 0.8,
				jumpGate,
				heuristicJump: true,
			},
		);
		expect(drive.jump).toBe(true);
		expect(drive.boost).toBe(true);
	});

	it("policySigmoid — stabilny zakres 0..1", () => {
		expect(policySigmoid(-4)).toBeLessThan(0.05);
		expect(policySigmoid(4)).toBeGreaterThan(0.95);
	});
});
