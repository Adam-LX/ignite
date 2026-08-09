import { describe, expect, it } from "vitest";

import { BotPolicy } from "../../src/ai/learning/BotPolicy";
import {
	mergeGlobalPolicyStates,
	mergePolicySyncPayload,
	normalizePolicyState,
	wrapSeedPolicy,
} from "../../src/net/policyMerge";

describe("policyMerge", () => {
	it("normalizePolicyState — seed JSON", () => {
		const policy = new BotPolicy(1);
		policy.generation = 3;
		policy.fitness = 4.2;
		const state = normalizePolicyState(policy.toData());
		expect(state?.active.generation).toBe(3);
		expect(state?.best?.fitness).toBe(4.2);
	});

	it("mergeGlobalPolicyStates — bierze wyższą generację", () => {
		const a = wrapSeedPolicy(new BotPolicy(1).toData());
		a.active.generation = 5;
		a.active.fitness = 2;
		const b = wrapSeedPolicy(new BotPolicy(2).toData());
		b.active.generation = 12;
		b.active.fitness = 6;

		const merged = mergeGlobalPolicyStates([a, b]);
		expect(merged.active.generation).toBe(12);
		expect(merged.active.fitness).toBeGreaterThan(2);
	});

	it("mergePolicySyncPayload — match_end bump generacji", () => {
		const current = wrapSeedPolicy(new BotPolicy(3).toData());
		current.active.generation = 4;
		const incoming = new BotPolicy(7);
		incoming.generation = 4;
		incoming.fitness = 8;

		const next = mergePolicySyncPayload(current, {
			active: incoming.toData(),
			best: incoming.toData(),
			reason: "match_end",
		});

		expect(next.active.generation).toBeGreaterThan(4);
		expect(next.totalMatches).toBe(1);
	});

	it("mergePolicySyncPayload — offline_train mocniejszy merge", () => {
		const current = wrapSeedPolicy(new BotPolicy(3).toData());
		current.active.generation = 10;
		current.active.fitness = 3;
		const incoming = new BotPolicy(7);
		incoming.generation = 20;
		incoming.fitness = 12;

		const merged = mergePolicySyncPayload(current, {
			active: incoming.toData(),
			best: incoming.toData(),
			reason: "offline_train",
		});

		expect(merged.active.generation).toBe(21);
		expect(merged.active.fitness).toBeGreaterThan(3);
		expect(merged.best?.fitness).toBe(12);
	});

	it("mergePolicySyncPayload — match_end dopisuje progressLog", () => {
		const current = wrapSeedPolicy(new BotPolicy(3).toData());
		const incoming = new BotPolicy(7);
		incoming.generation = 4;
		incoming.fitness = 8;

		const next = mergePolicySyncPayload(current, {
			active: incoming.toData(),
			best: incoming.toData(),
			reason: "match_end",
			botDelta: 2,
			aerialTouches: 1,
		});

		expect(next.progressLog).toHaveLength(1);
		expect(next.progressLog?.[0]?.botDelta).toBe(2);
		expect(next.progressLog?.[0]?.aerialTouches).toBe(1);
	});
});
