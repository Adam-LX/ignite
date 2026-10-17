import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RL_ARENA } from "../../src/visual/arenaConstants";
import { SaveAnticipation } from "../../src/visual/saveAnticipation";

describe("SaveAnticipation", () => {
	it("nie buduje pulse gdy piłka nie grozi bramce", () => {
		const s = new SaveAnticipation();
		const ballPos = new THREE.Vector3(0, 0.5, 0);
		const ballVel = new THREE.Vector3(0, 0, 12);
		for (let i = 0; i < 30; i++) {
			s.sample("blue", ballPos, ballVel, 1 / 60);
		}
		expect(s.getPresentation().pulse).toBeLessThan(0.04);
		expect(s.getPresentation().vignette).toBe(0);
	});

	it("buduje pulse gdy piłka leci w własną bramkę (bez winiety)", () => {
		const s = new SaveAnticipation();
		const ballPos = new THREE.Vector3(0, 0.6, -RL_ARENA.HALF_LENGTH + 20);
		const ballVel = new THREE.Vector3(0, 0, -12);
		for (let i = 0; i < 45; i++) {
			s.sample("blue", ballPos, ballVel, 1 / 60);
		}
		const p = s.getPresentation();
		expect(p.pulse).toBeGreaterThan(0.15);
		expect(p.vignette).toBe(0);
	});

	it("null team → decay do zera", () => {
		const s = new SaveAnticipation();
		const ballPos = new THREE.Vector3(0, 0.6, -RL_ARENA.HALF_LENGTH + 18);
		const ballVel = new THREE.Vector3(0, 0, -14);
		for (let i = 0; i < 30; i++) {
			s.sample("blue", ballPos, ballVel, 1 / 60);
		}
		expect(s.getPresentation().pulse).toBeGreaterThan(0.1);
		for (let i = 0; i < 60; i++) {
			s.sample(null, ballPos, ballVel, 1 / 60);
		}
		expect(s.getPresentation().pulse).toBeLessThan(0.04);
	});
});
