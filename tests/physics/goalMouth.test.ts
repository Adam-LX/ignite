import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { detectGoalScored } from "../../src/visual/arena";
import { isBallInsideGoalFrame } from "../../src/visual/goalPocket";
import { isInGoalMouth } from "../../src/util/rlContacts";
import { RL_BALL } from "../../src/util/rlConstants";
import { RL_ARENA } from "../../src/visual/arenaConstants";

const R = RL_BALL.radius;

describe("Bramka — światło na murawie", () => {
	it("piłka tocząca się po ziemi jest w świetle bramki (x=0)", () => {
		const pos = new THREE.Vector3(0, R, RL_ARENA.HALF_LENGTH - 0.4);
		expect(isBallInsideGoalFrame(pos, R)).toBe(true);
		expect(isInGoalMouth(pos, R)).toBe(true);
	});

	it("odrzuca piłkę wyraźnie pod murawą", () => {
		const pos = new THREE.Vector3(0, R - 0.2, RL_ARENA.HALF_LENGTH - 0.4);
		expect(isBallInsideGoalFrame(pos, R)).toBe(false);
	});

	it("wykrywa gola dla powolnej piłki na ziemi za linią", () => {
		const pos = new THREE.Vector3(0, R, RL_ARENA.HALF_LENGTH + 0.5);
		expect(detectGoalScored(pos, R)).toBe("blue");
	});

	it("blokuje piłkę obok słupka (poza światłem)", () => {
		const pos = new THREE.Vector3(
			RL_ARENA.GOAL_WIDTH / 2 + 1,
			R,
			RL_ARENA.HALF_LENGTH - 0.2,
		);
		expect(isBallInsideGoalFrame(pos, R)).toBe(false);
	});
});
