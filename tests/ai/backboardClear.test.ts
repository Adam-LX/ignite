import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { isBackboardBall } from "../../src/ai/botTactics";
import { RL_ARENA } from "../../src/visual/arenaConstants";

describe("isBackboardBall", () => {
	const ownBlue = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);

	it("wykrywa wysoką piłkę głęboko przy bramce blue", () => {
		const ball = new THREE.Vector3(0, 5.2, -RL_ARENA.HALF_LENGTH * 0.78);
		expect(isBackboardBall(ball, ownBlue)).toBe(true);
	});

	it("odrzuca piłkę w midfield", () => {
		const ball = new THREE.Vector3(0, 6, 0);
		expect(isBackboardBall(ball, ownBlue)).toBe(false);
	});

	it("odrzuca niską piłkę przy linii", () => {
		const ball = new THREE.Vector3(0, 1.2, -RL_ARENA.HALF_LENGTH * 0.8);
		expect(isBackboardBall(ball, ownBlue)).toBe(false);
	});
});
