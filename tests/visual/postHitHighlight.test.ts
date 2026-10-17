import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	evaluatePostHit,
	PostHitHighlight,
} from "../../src/visual/postHitHighlight";
import { RL_BALL } from "../../src/util/rlConstants";
import { RL_ARENA } from "../../src/visual/arenaConstants";

const R = RL_BALL.radius;

describe("postHitHighlight", () => {
	it("wykrywa szybki strzał w słupek", () => {
		const pos = new THREE.Vector3(
			RL_ARENA.GOAL_WIDTH / 2 - 0.15,
			R + 0.4,
			-RL_ARENA.HALF_LENGTH + 0.35,
		);
		const vel = new THREE.Vector3(0, 0, -18);
		expect(evaluatePostHit(pos, vel, R)).toBe(true);
	});

	it("ignoruje powolne toczenie w bramce", () => {
		const pos = new THREE.Vector3(0, R, -RL_ARENA.HALF_LENGTH + 0.5);
		const vel = new THREE.Vector3(0, 0, -2);
		expect(evaluatePostHit(pos, vel, R)).toBe(false);
	});

	it("ignoruje piłkę w środku światła bramki", () => {
		const pos = new THREE.Vector3(0, R, -RL_ARENA.HALF_LENGTH + 0.4);
		const vel = new THREE.Vector3(0, 0, -20);
		expect(evaluatePostHit(pos, vel, R)).toBe(false);
	});

	it("shake cue miękki (pro: camera shake off)", () => {
		const h = new PostHitHighlight();
		const pos = new THREE.Vector3(
			RL_ARENA.GOAL_WIDTH / 2 - 0.15,
			R + 0.4,
			-RL_ARENA.HALF_LENGTH + 0.35,
		);
		const vel = new THREE.Vector3(0, 0, -18);
		expect(h.sample(pos, vel, R, 1 / 60)).toBe(true);
		expect(h.getPresentation().shake).toBeLessThanOrEqual(0.16);
	});
});
