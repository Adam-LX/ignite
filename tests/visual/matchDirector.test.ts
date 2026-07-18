import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { MatchDirector } from "../../src/visual/matchDirector/MatchDirector";

describe("MatchDirector", () => {
	it("priority: goal preempts demo", () => {
		const d = new MatchDirector();
		d.setMode("on");
		const focus = new THREE.Vector3(1, 0, 2);
		expect(d.request({ kind: "demo", focus })).toBe(true);
		expect(d.request({ kind: "goal", focus })).toBe(true);
		const pose = d.update(0.05);
		expect(pose.active).toBe(true);
		expect(pose.kind).toBe("goal");
	});

	it("does not trigger twice within 2s cooldown", () => {
		const d = new MatchDirector();
		d.setMode("on");
		const focus = new THREE.Vector3();
		expect(d.request({ kind: "flipReset", focus })).toBe(true);
		for (let i = 0; i < 70; i++) d.update(1 / 60);
		expect(d.isActive()).toBe(false);
		expect(d.getCooldownLeft()).toBeGreaterThan(0);
		expect(d.request({ kind: "flipReset", focus })).toBe(false);
		expect(d.request({ kind: "demo", focus })).toBe(false);
		for (let i = 0; i < 130; i++) d.update(1 / 60);
		expect(d.request({ kind: "demo", focus })).toBe(true);
	});

	it("goal bypasses cooldown of lower shots", () => {
		const d = new MatchDirector();
		d.setMode("on");
		const focus = new THREE.Vector3();
		d.request({ kind: "demo", focus });
		for (let i = 0; i < 80; i++) d.update(1 / 60);
		expect(d.request({ kind: "goal", focus })).toBe(true);
	});

	it("off mode rejects all shots", () => {
		const d = new MatchDirector();
		d.setMode("off");
		expect(d.request({ kind: "goal", focus: new THREE.Vector3() })).toBe(
			false,
		);
	});

	it("reduced mode disables goal orbit flag", () => {
		const d = new MatchDirector();
		d.setMode("reduced");
		d.request({ kind: "goal", focus: new THREE.Vector3(0, 1, 40) });
		const pose = d.update(0.2);
		expect(pose.allowOrbit).toBe(false);
		expect(pose.active).toBe(true);
	});
});
