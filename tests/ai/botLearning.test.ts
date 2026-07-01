import { describe, expect, it, vi, beforeEach } from "vitest";

import { BotPolicy } from "../../src/ai/learning/BotPolicy";
import { BotLearning } from "../../src/ai/learning/BotLearning";
import { deriveTuning, resolveLearnedDrive } from "../../src/ai/learning/BotLearningTuning";
import type { JumpGateContext } from "../../src/ai/learning/BotJumpResolver";

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
	it("predict zwraca 4 wyjścia", () => {
		const policy = new BotPolicy(7);
		const obs = new Float32Array(18).fill(0.1);
		const out = policy.predict(obs);
		expect(out.length).toBe(4);
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
		expect(restored.predict(new Float32Array(18).fill(0))).toEqual(
			policy.predict(new Float32Array(18).fill(0)),
		);
	});

	it("mutate zmienia wagi", () => {
		const policy = new BotPolicy(3);
		const before = policy.toData().w1[0];
		policy.mutate(1);
		expect(policy.toData().w1[0]).not.toBe(before);
	});
});

describe("BotLearningTuning", () => {
	it("aktywna polityka moduluje intercept, aerial i agresję", () => {
		const out = new Float32Array([0.8, 0.5, 0.6, 0.4]);
		const tuning = deriveTuning(out, 8, 40, true);
		expect(tuning.interceptLead).toBeGreaterThan(1.05);
		expect(tuning.aggression).toBeGreaterThan(1);
		expect(tuning.aerialBias).toBeGreaterThan(0.45);
		expect(tuning.defenseBias).toBeGreaterThan(0);
	});

	it("resolveLearnedDrive — boost przy aerial gdy skok zaakceptowany", () => {
		const outputs = new Float32Array([0.5, 0.9, 0.85, 0.7]);
		const tuning = deriveTuning(outputs, 10, 50, true);
		const blocked = resolveLearnedDrive(
			{ forward: 1, yaw: 0, boost: false, jump: false },
			{
				policyOutputs: outputs,
				tuning,
				maturity: 0.8,
				jumpGate: {
					forceRecovery: false,
					forcedJump: false,
					inAir: false,
					onGround: true,
					ballAirborne: false,
					ballAboveBot: false,
					ballY: 0.4,
					horizDist: 3,
					defending: false,
					looseBall: true,
					goalieOrClearance: false,
				},
				heuristicJump: false,
			},
		);
		expect(blocked.jump).toBe(false);
		expect(blocked.boost).toBe(false);

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
});

describe("BotLearning", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 503,
			}),
		);
	});

	it("onMatchEnd liczy wynik z perspektywy bota", async () => {
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
