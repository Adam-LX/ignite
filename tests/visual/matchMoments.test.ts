import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { BallTouchTracker } from "../../src/game/BallTouchTracker";
import type { CarEntity } from "../../src/game/CarEntity";
import { RL_ARENA } from "../../src/visual/arenaConstants";
import {
	pickAssistMoment,
	pickDemoMoment,
	pickGoalMoment,
	pickHumanHitMoment,
	shotDistanceFromTouch,
} from "../../src/visual/matchMoments/matchMoments";

function mockCar(
	slot: number,
	team: "blue" | "orange" | null,
	isHuman: boolean,
): CarEntity {
	return {
		slotIndex: slot,
		team,
		isHuman,
		individualScore: 0,
		displayName: "Test",
	} as CarEntity;
}

describe("pickGoalMoment", () => {
	it("own goal dla gracza", () => {
		const human = mockCar(0, "blue", true);
		const touch = {
			scoringTeam: "orange" as const,
			scorerSlot: 0,
			assistSlot: null,
			isOwnGoal: true,
			lastTouch: {
				slotIndex: 0,
				timeSec: 10,
				ballY: 0.5,
				inAir: false,
				flipping: false,
				onWall: false,
				impact: 6,
				carPos: new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH + 10),
			},
			prevTouch: null,
		};
		const m = pickGoalMoment({
			scoringTeam: "orange",
			touch,
			cars: [human],
			humanCar: human,
			mode: "1v1",
			isOvertime: false,
			isGoldenGoal: false,
			isKickoffWindow: false,
			matchTimeSec: 10,
			timeRemainingSec: 120,
			matchEndsAfterGoal: false,
			humanGoalStreak: 0,
			hadPowerUp: false,
			recentWall: false,
			recentCeiling: false,
			doubleTapReady: false,
		});
		expect(m?.label).toBe("OWN GOAL!");
	});

	it("long shot z dystansu", () => {
		const human = mockCar(0, "blue", true);
		const touch = {
			scoringTeam: "blue" as const,
			scorerSlot: 0,
			assistSlot: null,
			isOwnGoal: false,
			lastTouch: {
				slotIndex: 0,
				timeSec: 40,
				ballY: 0.4,
				inAir: false,
				flipping: false,
				onWall: false,
				impact: 12,
				carPos: new THREE.Vector3(0, 0, 15),
			},
			prevTouch: null,
		};
		expect(shotDistanceFromTouch(touch.lastTouch, "blue")).toBeGreaterThan(35);
		const m = pickGoalMoment({
			scoringTeam: "blue",
			touch,
			cars: [human],
			humanCar: human,
			mode: "1v1",
			isOvertime: false,
			isGoldenGoal: false,
			isKickoffWindow: false,
			matchTimeSec: 40,
			timeRemainingSec: 120,
			matchEndsAfterGoal: false,
			humanGoalStreak: 0,
			hadPowerUp: false,
			recentWall: false,
			recentCeiling: false,
			doubleTapReady: false,
		});
		expect(m?.id).toBe("long_shot");
	});

	it("overtime winner", () => {
		const human = mockCar(0, "blue", true);
		const touch = {
			scoringTeam: "blue" as const,
			scorerSlot: 0,
			assistSlot: null,
			isOwnGoal: false,
			lastTouch: null,
			prevTouch: null,
		};
		const m = pickGoalMoment({
			scoringTeam: "blue",
			touch,
			cars: [human],
			humanCar: human,
			mode: "1v1",
			isOvertime: true,
			isGoldenGoal: true,
			isKickoffWindow: false,
			matchTimeSec: 400,
			timeRemainingSec: 0,
			matchEndsAfterGoal: true,
			humanGoalStreak: 1,
			hadPowerUp: false,
			recentWall: false,
			recentCeiling: false,
			doubleTapReady: false,
		});
		expect(m?.label).toBe("OVERTIME WINNER!");
	});
});

describe("pickAssistMoment", () => {
	it("ASSIST dla human playmakera", () => {
		const human = mockCar(1, "blue", true);
		const m = pickAssistMoment(human, {
			slotIndex: 1,
			timeSec: 5,
			ballY: 0.5,
			inAir: false,
			flipping: false,
			onWall: false,
			impact: 5,
			carPos: new THREE.Vector3(),
		});
		expect(m?.label).toBe("ASSIST!");
	});

	it("PLAYMAKER przy aerial pass", () => {
		const human = mockCar(1, "blue", true);
		const m = pickAssistMoment(human, {
			slotIndex: 1,
			timeSec: 5,
			ballY: 3,
			inAir: true,
			flipping: false,
			onWall: false,
			impact: 11,
			carPos: new THREE.Vector3(),
		});
		expect(m?.label).toBe("PLAYMAKER!");
	});
});

describe("pickHumanHitMoment", () => {
	it("flip reset w powietrzu", () => {
		const m = pickHumanHitMoment({
			impact: 6,
			ballY: 2,
			inAir: true,
			flipping: true,
			onWall: false,
			matchTimeSec: 1,
		});
		expect(m?.label).toBe("FLIP RESET!");
	});

	it("aerial touch", () => {
		const m = pickHumanHitMoment({
			impact: 5,
			ballY: 3,
			inAir: true,
			flipping: false,
			onWall: false,
			matchTimeSec: 1,
		});
		expect(m?.label).toBe("AERIAL!");
	});
});

describe("pickDemoMoment", () => {
	it("supersonic demo", () => {
		const m = pickDemoMoment(
			{
				impact: 14,
				humanAttacker: true,
				humanSpeedMps: 24,
				matchTimeSec: 2,
			},
			1,
			false,
		);
		expect(m?.label).toBe("SUPERSONIC BUMP!");
	});

	it("demo chain", () => {
		const m = pickDemoMoment(
			{
				impact: 12,
				humanAttacker: true,
				humanSpeedMps: 16,
				matchTimeSec: 4,
			},
			2,
			false,
		);
		expect(m?.label).toBe("DEMO CHAIN!");
	});
});

describe("BallTouchTracker.buildGoalContext", () => {
	it("wykrywa assist i own goal", () => {
		const tracker = new BallTouchTracker();
		const cars = [
			mockCar(0, "blue", true),
			mockCar(1, "blue", false),
			mockCar(2, "orange", false),
		];
		tracker.pushTouch(
			{
				slotIndex: 1,
				timeSec: 8,
				ballY: 0.5,
				inAir: false,
				flipping: false,
				onWall: false,
				impact: 4,
				carPos: new THREE.Vector3(),
			},
		);
		tracker.pushTouch(
			{
				slotIndex: 0,
				timeSec: 9,
				ballY: 0.5,
				inAir: false,
				flipping: false,
				onWall: false,
				impact: 6,
				carPos: new THREE.Vector3(),
			},
		);
		const ctx = tracker.buildGoalContext("orange", cars, false);
		expect(ctx.assistSlot).toBe(1);
		expect(ctx.isOwnGoal).toBe(true);
	});
});
