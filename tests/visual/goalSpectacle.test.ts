import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { GoalSpectacle } from "../../src/visual/goalSpectacle";

describe("GoalSpectacle", () => {
	it("ramps sim time scale down then back up after trigger", () => {
		const spectacle = new GoalSpectacle();
		spectacle.trigger("blue", new THREE.Vector3(0, 1, 50));

		expect(spectacle.getSimTimeScale()).toBeLessThan(0.2);

		for (let i = 0; i < 40; i++) {
			spectacle.update(1 / 60);
		}
		expect(spectacle.getSimTimeScale()).toBeGreaterThan(0.35);

		for (let i = 0; i < 55; i++) {
			spectacle.update(1 / 60);
		}
		expect(spectacle.getSimTimeScale()).toBeCloseTo(1, 2);
	});

	it("exposes presentation peaks right after trigger", () => {
		const spectacle = new GoalSpectacle();
		spectacle.trigger("orange", new THREE.Vector3());

		const instant = spectacle.getPresentation();
		expect(instant.flash).toBeGreaterThan(0.95);
		expect(instant.team).toBe("orange");
		expect(instant.warmGrade).toBeGreaterThan(0.5);
		expect(instant.coolGrade).toBe(0);

		spectacle.update(0.12);
		const pres = spectacle.getPresentation();
		expect(pres.bloom).toBeGreaterThan(0.25);
		expect(pres.dofFocus).toBeGreaterThan(0.7);
	});

	it("orbit camera sweeps toward 180° over duration", () => {
		const spectacle = new GoalSpectacle();
		const focus = new THREE.Vector3(0, 1, 40);
		spectacle.trigger("blue", focus);
		const start = spectacle.getCameraPose();
		expect(start).not.toBeNull();
		expect(start!.orbitNorm).toBe(0);

		for (let i = 0; i < 90; i++) spectacle.update(1 / 60);
		const mid = spectacle.getCameraPose();
		expect(mid!.orbitNorm).toBeGreaterThan(0.4);
		expect(mid!.eye.distanceTo(focus)).toBeGreaterThan(8);
	});

	it("reduced mode uses static wide shot", () => {
		const spectacle = new GoalSpectacle();
		spectacle.trigger("blue", new THREE.Vector3(0, 1, 40), { reduced: true });
		expect(spectacle.isReduced()).toBe(true);
		const pose = spectacle.getCameraPose();
		expect(pose!.orbitNorm).toBe(0);
	});

	it("skip only after 1s", () => {
		const spectacle = new GoalSpectacle();
		spectacle.trigger("orange", new THREE.Vector3());
		expect(spectacle.canSkip()).toBe(false);
		expect(spectacle.skip()).toBe(false);
		spectacle.update(1.05);
		expect(spectacle.canSkip()).toBe(true);
		expect(spectacle.skip()).toBe(true);
		spectacle.update(0.2);
		expect(spectacle.isPresentationActive()).toBe(false);
	});

	it("blue team grade is cool, orange is warm", () => {
		const blue = new GoalSpectacle();
		blue.trigger("blue", new THREE.Vector3());
		expect(blue.getPresentation().coolGrade).toBeGreaterThan(0.8);
		expect(blue.getPresentation().warmGrade).toBe(0);

		const orange = new GoalSpectacle();
		orange.trigger("orange", new THREE.Vector3());
		expect(orange.getPresentation().warmGrade).toBeGreaterThan(0.8);
	});
});
