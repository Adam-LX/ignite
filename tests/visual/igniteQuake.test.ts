import { describe, expect, it } from "vitest";
import { IgniteQuake } from "../../src/visual/igniteQuake";

describe("IgniteQuake", () => {
	it("trigger sets active envelope with low-freq offset", () => {
		const q = new IgniteQuake();
		expect(q.isActive()).toBe(false);
		q.trigger("goal", 1);
		expect(q.isActive()).toBe(true);
		const p = q.update(0.016);
		expect(p.amount).toBeGreaterThan(0.2);
		expect(p.offset.length()).toBeGreaterThan(0.001);
		expect(p.fovKick).toBeGreaterThan(0.5);
		expect(p.overlayHard).toBe(true);
	});

	it("signature peaks harder than impact", () => {
		const a = new IgniteQuake();
		const b = new IgniteQuake();
		a.trigger("signature", 1);
		b.trigger("impact", 1);
		const pa = a.update(0.02);
		const pb = b.update(0.02);
		expect(pa.amount).toBeGreaterThan(pb.amount);
		expect(pa.fovKick).toBeGreaterThan(pb.fovKick);
	});

	it("stronger kind stacks over weaker mid-quake", () => {
		const q = new IgniteQuake();
		q.trigger("impact", 0.8);
		const weak = q.update(0.05).amount;
		q.trigger("goal", 1.1);
		const strong = q.update(0.016).amount;
		expect(strong).toBeGreaterThan(weak * 0.9);
		expect(q.isActive()).toBe(true);
	});

	it("decays to inactive", () => {
		const q = new IgniteQuake();
		q.trigger("kickoff", 1);
		for (let i = 0; i < 80; i++) q.update(0.02);
		expect(q.isActive()).toBe(false);
		const p = q.update(0.016);
		expect(p.amount).toBe(0);
		expect(p.offset.lengthSq()).toBe(0);
	});
});
