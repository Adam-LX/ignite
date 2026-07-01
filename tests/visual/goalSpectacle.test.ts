import { describe, expect, it } from "vitest";

import { GoalSpectacle } from "../../src/visual/goalSpectacle";
import * as THREE from "three";

describe("GoalSpectacle", () => {
	it("ramps sim time scale down then back up after trigger", () => {
		const spectacle = new GoalSpectacle();
		spectacle.trigger("blue", new THREE.Vector3(0, 1, 50));

		expect(spectacle.getSimTimeScale()).toBeLessThan(0.2);

		for (let i = 0; i < 40; i++) {
			spectacle.update(1 / 60);
		}
		expect(spectacle.getSimTimeScale()).toBeGreaterThan(0.35);

		for (let i = 0; i < 40; i++) {
			spectacle.update(1 / 60);
		}
		expect(spectacle.getSimTimeScale()).toBe(1);
	});

	it("exposes presentation peaks right after trigger", () => {
		const spectacle = new GoalSpectacle();
		spectacle.trigger("orange", new THREE.Vector3());

		const instant = spectacle.getPresentation();
		expect(instant.flash).toBeGreaterThan(0.85);
		expect(instant.team).toBe("orange");

		spectacle.update(0.12);
		const pres = spectacle.getPresentation();
		expect(pres.bloom).toBeGreaterThan(0.25);
	});
});
