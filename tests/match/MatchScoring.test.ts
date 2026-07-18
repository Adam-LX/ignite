import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { GoalTouchContext } from "../../src/game/BallTouchTracker";
import {
	evaluateCenter,
	evaluateSaveKind,
	evaluateShot,
	MatchScoring,
	RL_SCORE_POINTS,
} from "../../src/match/MatchScoring";
import { RL_ARENA } from "../../src/visual/arenaConstants";

function mockCar(
	slotIndex: number,
	team: "blue" | "orange" | null,
	name = "P",
) {
	return {
		slotIndex,
		team,
		displayName: name,
		isHuman: slotIndex === 0,
		player: {} as never,
		visuals: {} as never,
		visualTeam: team ?? "blue",
		individualScore: 0,
	} as import("../../src/game/CarEntity").CarEntity;
}

describe("MatchScoring", () => {
	it("przyznaje punkty RL za gol i asystę", () => {
		const scoring = new MatchScoring();
		const cars = [
			mockCar(0, "blue", "Striker"),
			mockCar(1, "orange", "Opp"),
			mockCar(2, "blue", "Passer"),
		];
		scoring.ensurePlayers(cars);

		const touch: GoalTouchContext = {
			scoringTeam: "blue",
			scorerSlot: 0,
			assistSlot: 2,
			isOwnGoal: false,
			lastTouch: null,
			prevTouch: null,
		};
		scoring.applyGoal(touch, cars, false);

		const rows = scoring.getRows(cars);
		const scorer = rows.find((r) => r.slotIndex === 0)!;
		const assist = rows.find((r) => r.slotIndex === 2)!;
		expect(scorer.score).toBe(RL_SCORE_POINTS.GOAL);
		expect(scorer.goals).toBe(1);
		expect(assist.score).toBe(RL_SCORE_POINTS.ASSIST);
		expect(assist.assists).toBe(1);
	});

	it("liczy dotknięcie z małą premią punktową", () => {
		const scoring = new MatchScoring();
		const car = mockCar(0, "blue");
		scoring.ensurePlayers([car]);
		const pos = new THREE.Vector3();
		const vel = new THREE.Vector3(0, 0, 5);
		scoring.onBallHit(car, pos, vel, 8, 1);
		const row = scoring.getRows([car])[0]!;
		expect(row.touches).toBe(1);
		expect(row.score).toBe(RL_SCORE_POINTS.TOUCH);
	});

	it("używa visualTeam w scoreboardzie gdy team jest null (Ignition)", () => {
		const scoring = new MatchScoring();
		const car = {
			...mockCar(1, null, "Rival"),
			visualTeam: "orange" as const,
		};
		scoring.ensurePlayers([car]);
		const row = scoring.getRows([car])[0]!;
		expect(row.team).toBe("orange");
	});
});

describe("centerDetection", () => {
	it("wykrywa dośrodkowanie w strefie bramkowej", () => {
		const pos = new THREE.Vector3(
			0,
			1.2,
			RL_ARENA.HALF_LENGTH - 4,
		);
		const vel = new THREE.Vector3(0, 0, 14);
		expect(evaluateCenter("blue", pos, vel)).toBe(true);
	});
});

describe("saveDetection", () => {
	it("rozróżnia epic save od zwykłego", () => {
		const pos = new THREE.Vector3(0, 1, -RL_ARENA.HALF_LENGTH + 6);
		const vel = new THREE.Vector3(0, 0, -16);
		expect(evaluateSaveKind("blue", pos, vel, 10)).toBe("epic");
		expect(evaluateSaveKind("blue", pos, vel, 2)).toBeNull();
	});
});

describe("shotDetection", () => {
	it("liczy strzał gdy piłka leci w bramkę", () => {
		const pos = new THREE.Vector3(0, 1, RL_ARENA.HALF_LENGTH - 18);
		const vel = new THREE.Vector3(0, 0, 16);
		expect(evaluateShot("blue", pos, vel)).toBe(true);
	});
});
