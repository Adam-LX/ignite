import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { RL_ARENA } from "../../src/visual/arenaConstants";
import {
	EpicSaveHighlight,
	evaluateEpicSave,
	ownGoalForTeam,
} from "../../src/visual/epicSaveHighlight";

describe("evaluateEpicSave", () => {
	const ownGoalBlue = ownGoalForTeam("blue");

	it("false gdy piłka nie leci w bramkę", () => {
		const ballPos = new THREE.Vector3(0, 0.5, 0);
		const ballVel = new THREE.Vector3(0, 0, 12);
		expect(
			evaluateEpicSave("blue", ballPos, ballVel, 8, true),
		).toBe(false);
	});

	it("true gdy piłka leci w bramkę blue i gracz dotyka", () => {
		const ballPos = new THREE.Vector3(0, 0.6, -RL_ARENA.HALF_LENGTH + 18);
		const ballVel = new THREE.Vector3(0, 0, -9);
		expect(
			evaluateEpicSave("blue", ballPos, ballVel, 6, true),
		).toBe(true);
	});

	it("false dla bota (nie human)", () => {
		const ballPos = new THREE.Vector3(0, 0.6, -RL_ARENA.HALF_LENGTH + 18);
		const ballVel = new THREE.Vector3(0, 0, -9);
		expect(
			evaluateEpicSave("blue", ballPos, ballVel, 6, false),
		).toBe(false);
	});

	it("false przy zbyt słabym uderzeniu", () => {
		const ballPos = new THREE.Vector3(0, 0.6, -RL_ARENA.HALF_LENGTH + 18);
		const ballVel = new THREE.Vector3(0, 0, -9);
		expect(
			evaluateEpicSave("blue", ballPos, ballVel, 1, true),
		).toBe(false);
	});
});

describe("EpicSaveHighlight", () => {
	it("triggeruje EPIC SAVE", () => {
		const h = new EpicSaveHighlight();
		h.trigger(5, 4);
		expect(h.isActive()).toBe(true);
		expect(h.getPresentation().label).toBe("EPIC SAVE");
	});

	it("CLUTCH SAVE przy szybkiej piłce", () => {
		const h = new EpicSaveHighlight();
		h.trigger(6, 10);
		expect(h.getPresentation().label).toBe("CLUTCH SAVE");
	});

	it("cooldown blokuje spam", () => {
		const h = new EpicSaveHighlight();
		h.trigger(8, 6);
		h.update(0.2);
		h.trigger(8, 6);
		expect(h.getPresentation().flash).toBeGreaterThan(0);
	});
});

describe("ownGoalForTeam", () => {
	it("blue broni -z", () => {
		expect(ownGoalForTeam("blue").z).toBeLessThan(0);
	});

	it("orange broni +z", () => {
		expect(ownGoalForTeam("orange").z).toBeGreaterThan(0);
	});
});
