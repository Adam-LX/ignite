import { describe, expect, it } from "vitest";
import { BallSurfaceTracker } from "../../src/visual/matchMoments/ballSurfaceTracker";
import { MatchMomentsController } from "../../src/visual/matchMoments/MatchMomentsController";
import { pickGoalMoment } from "../../src/visual/matchMoments/matchMoments";
import type { CarEntity } from "../../src/game/CarEntity";
import * as THREE from "three";
import { RL_ARENA } from "../../src/visual/arenaConstants";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

function baseGoal(overrides: Record<string, unknown> = {}) {
	const human = mockCar(0, "blue", true);
	const touch = {
		scoringTeam: "blue" as const,
		scorerSlot: 0,
		assistSlot: null,
		isOwnGoal: false,
		lastTouch: {
			slotIndex: 0,
			timeSec: 40,
			ballY: 0.5,
			inAir: false,
			flipping: false,
			onWall: false,
			impact: 6,
			carPos: new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH - 8),
		},
		prevTouch: null,
	};
	return {
		scoringTeam: "blue" as const,
		touch,
		cars: [human],
		humanCar: human,
		mode: "1v1" as const,
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
		...overrides,
	};
}

describe("pickGoalMoment wall/ceiling/double_tap", () => {
	it("WALL SHOT gdy recentWall (bez ceiling)", () => {
		const m = pickGoalMoment(baseGoal({ recentWall: true }));
		expect(m?.id).toBe("wall_shot");
		expect(m?.label).toBe("WALL SHOT!");
	});

	it("CEILING SHOT ma priorytet nad wall", () => {
		const m = pickGoalMoment(
			baseGoal({ recentWall: true, recentCeiling: true }),
		);
		expect(m?.id).toBe("ceiling_shot");
	});

	it("DOUBLE TAP gdy primed", () => {
		const m = pickGoalMoment(baseGoal({ doubleTapReady: true }));
		expect(m?.id).toBe("double_tap");
	});

	it("BUZZER BEATER w ostatnich 3s", () => {
		const m = pickGoalMoment(baseGoal({ timeRemainingSec: 2.5 }));
		expect(m?.id).toBe("buzzer_beater");
	});

	it("KICKOFF GOAL w oknie kickoff", () => {
		const m = pickGoalMoment(baseGoal({ isKickoffWindow: true }));
		expect(m?.id).toBe("kickoff_goal");
	});
});

describe("BallSurfaceTracker", () => {
	it("klasyfikuje wall / ceiling / floor po normalnej", () => {
		const t = new BallSurfaceTracker();
		expect(t.noteContactNormal(1, 0, 0, 10)).toBe("wall");
		expect(t.recentWall(10.5)).toBe(true);
		expect(t.noteContactNormal(0, -1, 0, 11)).toBe("ceiling");
		expect(t.recentCeiling(11.2)).toBe(true);
		expect(t.noteContactNormal(0, 1, 0, 12)).toBe("floor");
		expect(t.recentWall(14)).toBe(false);
	});

	it("reset czyści okna recent*", () => {
		const t = new BallSurfaceTracker();
		t.noteContactNormal(0, 0, 1, 5);
		t.reset();
		expect(t.recentWall(5.1)).toBe(false);
	});
});

describe("MatchMomentsController double-tap reset", () => {
	it("reset czyści doubleTapPrimed między rundami", () => {
		const c = new MatchMomentsController();
		c.setMatchTime(10);
		c.onHumanBallHit({
			impact: 5,
			ballY: 2,
			inAir: true,
			flipping: false,
			onWall: false,
		});
		c.setMatchTime(10.4);
		c.onHumanBallHit({
			impact: 5,
			ballY: 2.2,
			inAir: true,
			flipping: false,
			onWall: false,
		});
		c.reset();
		expect(c.consumeDoubleTapReady()).toBe(false);
		expect(c.highlight.isActive()).toBe(false);
	});

	it("consumeDoubleTapReady jednorazowo po dwóch air touchach", () => {
		const c = new MatchMomentsController();
		c.setMatchTime(20);
		c.onHumanBallHit({
			impact: 4,
			ballY: 1.5,
			inAir: true,
			flipping: false,
			onWall: false,
		});
		c.setMatchTime(20.5);
		c.onHumanBallHit({
			impact: 4,
			ballY: 1.8,
			inAir: true,
			flipping: false,
			onWall: false,
		});
		expect(c.consumeDoubleTapReady()).toBe(true);
		expect(c.consumeDoubleTapReady()).toBe(false);
	});
});

describe("wall_shot HUD CSS", () => {
	it("flash + banner mają styl wall_shot", () => {
		const css = readFileSync(
			resolve(__dirname, "../../src/style.css"),
			"utf8",
		);
		expect(css).toContain('#match-moment-flash[data-moment="wall_shot"]');
		expect(css).toContain('#match-moment-banner[data-moment="wall_shot"]');
	});
});
