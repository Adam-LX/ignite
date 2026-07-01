import { describe, expect, it } from "vitest";

import {
	isJumpSituationAllowed,
	policySigmoid,
	resolveJumpDecision,
	type JumpGateContext,
} from "../../src/ai/learning/BotJumpResolver";
import { deriveTuning, resolveLearnedDrive } from "../../src/ai/learning/BotLearningTuning";

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
	it("blokuje skok do piłki na ziemi", () => {
		const ctx = groundGate();
		expect(isJumpSituationAllowed(ctx)).toBe(false);
		expect(
			resolveJumpDecision(true, 0.9, deriveTuning(new Float32Array(4), 5, 10, true), 0.8, ctx),
		).toBe(false);
	});

	it("pozwala na skok przy lobie gdy heurystyka i polityka zgadzają się", () => {
		const ctx = groundGate({
			looseBall: false,
			ballAirborne: true,
			ballAboveBot: true,
			ballY: 2.4,
		});
		const tuning = deriveTuning(new Float32Array([0.2, 0.7, 0.5, 0.85]), 12, 30, true);
		expect(
			resolveJumpDecision(true, 1.2, tuning, 0.75, ctx),
		).toBe(true);
	});

	it("resolveLearnedDrive — boost przy aerial gdy skok zaakceptowany", () => {
		const tuning = deriveTuning(new Float32Array([0.5, 0.9, 0.85, 0.7]), 10, 50, true);
		const jumpGate = groundGate({
			looseBall: false,
			ballAirborne: true,
			ballAboveBot: true,
			ballY: 2.5,
		});
		const drive = resolveLearnedDrive(
			{ forward: 1, yaw: 0, boost: false, jump: false },
			{
				policyOutputs: new Float32Array([0.5, 0.9, 0.85, 0.7]),
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
