import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { BotPolicy, POLICY_OUTPUT_SIZE } from "../../src/ai/learning/BotPolicy";
import { applyLearnedTargetOffset } from "../../src/ai/learning/BotLearnedTargeting";
import { deriveTuning, resolveLearnedDrive } from "../../src/ai/learning/BotLearningTuning";
import type { JumpGateContext } from "../../src/ai/learning/BotJumpResolver";

function fullOutputs(values: number[]): Float32Array {
	const out = new Float32Array(POLICY_OUTPUT_SIZE);
	for (let i = 0; i < Math.min(values.length, POLICY_OUTPUT_SIZE); i++) {
		out[i] = values[i]!;
	}
	return out;
}

function aerialGate(): JumpGateContext {
	return {
		forceRecovery: false,
		forcedJump: false,
		inAir: false,
		onGround: true,
		ballAirborne: true,
		ballAboveBot: true,
		ballY: 2.3,
		horizDist: 4,
		defending: false,
		looseBall: false,
		goalieOrClearance: false,
	};
}

describe("BotPolicy", () => {
	it("predict zwraca 12 wyjść", () => {
		const policy = new BotPolicy(7);
		const obs = new Float32Array(21).fill(0.1);
		const out = policy.predict(obs);
		expect(out.length).toBe(12);
		for (const v of out) {
			expect(v).toBeGreaterThanOrEqual(-1);
			expect(v).toBeLessThanOrEqual(1);
		}
	});

	it("serializacja round-trip", () => {
		const policy = new BotPolicy(11);
		policy.generation = 5;
		policy.fitness = 42;
		const restored = BotPolicy.fromData(policy.toData());
		expect(restored.generation).toBe(5);
		expect(restored.fitness).toBe(42);
		expect(restored.predict(new Float32Array(21).fill(0))).toEqual(
			policy.predict(new Float32Array(21).fill(0)),
		);
	});

	it("migracja starych wag 4-wyjściowych", () => {
		const legacy = new BotPolicy(3);
		const data = legacy.toData();
		data.w2 = data.w2.slice(0, 20 * 4);
		data.b2 = data.b2.slice(0, 4);
		data.b1 = data.b1.slice(0, 20);
		data.w1 = data.w1.slice(0, 18 * 20);
		const migrated = BotPolicy.fromData(data);
		expect(migrated.predict(new Float32Array(21)).length).toBe(12);
	});

	it("migracja wag 18-wejściowych do 21", () => {
		const legacy = new BotPolicy(9);
		const data = legacy.toData();
		data.w1 = data.w1.slice(0, 18 * 32);
		const migrated = BotPolicy.fromData(data);
		const out = migrated.predict(new Float32Array(21).fill(0.2));
		expect(out.length).toBe(12);
		const withPose = new Float32Array(21);
		withPose.fill(0.1);
		withPose[18] = -0.9;
		withPose[19] = 0.25;
		withPose[20] = 1;
		expect(migrated.predict(withPose)).toBeDefined();
	});

	it("mutate zmienia wagi", () => {
		const policy = new BotPolicy(3);
		const before = policy.toData().w1[0];
		policy.mutate(1);
		expect(policy.toData().w1[0]).not.toBe(before);
	});
});

describe("BotLearningTuning", () => {
	it("aktywna polityka daje umiarkowaną autonomię i cel jazdy", () => {
		const out = fullOutputs([0.8, 0.5, 0.6, 0.4, 0.7, -0.3, 0.5, 0.6, 0.4, -0.2, 0.8, 1.2]);
		const tuning = deriveTuning(out, 8, 40, true);
		expect(tuning.interceptLead).toBeGreaterThan(1.05);
		expect(tuning.policyAutonomy).toBeGreaterThan(0.35);
		expect(tuning.policyAutonomy).toBeLessThanOrEqual(0.72);
		expect(Math.abs(tuning.aimOffsetX)).toBeGreaterThan(0.5);
		expect(tuning.steerBlend).toBeGreaterThan(0.4);
		expect(tuning.steerBlend).toBeLessThanOrEqual(0.62);
	});

	it("resolveLearnedDrive — pełny blend forward/yaw z sieci", () => {
		const outputs = fullOutputs([0, 0, 0, 0, 0.9, -0.8, 0, 0, 0, 0, 0, 1.5]);
		const tuning = deriveTuning(outputs, 12, 50, true);
		const drive = resolveLearnedDrive(
			{ forward: 1, yaw: 0, boost: false, forwardAxis: 1, yawAxis: 0 },
			{
				policyOutputs: outputs,
				tuning,
				maturity: 0.85,
				jumpGate: aerialGate(),
				heuristicJump: false,
			},
		);
		expect(drive.yawAxis).toBeLessThan(-0.3);
		expect(Math.abs(drive.forwardAxis!)).toBeGreaterThan(0.5);
	});

	it("resolveLearnedDrive — boost przy aerial gdy skok zaakceptowany", () => {
		const outputs = fullOutputs([0.5, 0.9, 0.85, 0.7, 0, 0, 0, 0, 0, 0, 0, 1]);
		const tuning = deriveTuning(outputs, 10, 50, true);
		const blocked = resolveLearnedDrive(
			{ forward: 1, yaw: 0, boost: false, jump: false },
			{
				policyOutputs: outputs,
				tuning,
				maturity: 0.8,
				jumpGate: {
					...aerialGate(),
					ballAirborne: false,
					ballY: 0.4,
					looseBall: true,
				},
				heuristicJump: false,
			},
		);
		expect(blocked.jump).toBe(false);

		const aerial = resolveLearnedDrive(
			{ forward: 1, yaw: 0, boost: false, jump: false },
			{
				policyOutputs: outputs,
				tuning,
				maturity: 0.8,
				jumpGate: aerialGate(),
				heuristicJump: true,
			},
		);
		expect(aerial.jump).toBe(true);
		expect(aerial.boost).toBe(true);
	});

	it("resolveLearnedDrive — boost przy skręcie do piłki (nie wycina na yaw)", () => {
		const outputs = fullOutputs([0, 0, 0.9, 0, 0.85, 0.55, 0, 0, 0, 0, 0, 1]);
		const tuning = deriveTuning(outputs, 10, 50, true);
		const drive = resolveLearnedDrive(
			{ forward: 1, yaw: 1, boost: true, forwardAxis: 0.9, yawAxis: 0.45 },
			{
				policyOutputs: outputs,
				tuning,
				maturity: 0.75,
				jumpGate: {
					...aerialGate(),
					ballAirborne: false,
					ballY: 0.45,
					looseBall: true,
				},
				heuristicJump: false,
			},
		);
		expect(drive.boost).toBe(true);
		expect(Math.abs(drive.forwardAxis ?? 0)).toBeGreaterThan(0.35);
	});
});

describe("BotLearning", () => {
	it("onMatchEnd liczy wynik z perspektywy bota", async () => {
		const { BotLearning } = await import("../../src/ai/learning/BotLearning");
		BotLearning.resetForTests();
		const learning = BotLearning.get();
		learning.loadPolicyData({
			...new BotPolicy(1).toData(),
			generation: 3,
			fitness: 10,
		});

		const cars = [
			{ isHuman: true, team: "blue", slotIndex: 0 },
			{ isHuman: false, team: "orange", slotIndex: 1 },
		] as import("../../src/game/CarEntity").CarEntity[];

		const beforeFitness = learning.fitness;
		learning.onMatchEnd(0, 3, cars);
		await new Promise((r) => setTimeout(r, 0));
		expect(learning.generation).toBe(4);
		expect(learning.fitness).not.toBe(beforeFitness);
	});
});
