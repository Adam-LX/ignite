import { describe, expect, it } from "vitest";

import {
	computeMatchTension,
	mapMatchPhaseToAtmosphere,
	MatchAtmosphereEngine,
} from "../../src/visual/matchAtmosphereEngine";

describe("computeMatchTension", () => {
	it("maksymalne napięcie przy remisie w ostatnich 30 s", () => {
		const t = computeMatchTension(0.9, 15, 0);
		expect(t).toBeGreaterThan(0.55);
	});

	it("niskie napięcie przy dużej przewadze na początku", () => {
		const t = computeMatchTension(0.1, 280, 4);
		expect(t).toBeLessThan(0.25);
	});
});

describe("mapMatchPhaseToAtmosphere", () => {
	it("kickoff w playing", () => {
		expect(
			mapMatchPhaseToAtmosphere("playing", {
				kickoff: true,
				overtime: false,
				scoringTeam: null,
			}),
		).toBe("kickoff");
	});

	it("overtime ma priorytet nad kickoff", () => {
		expect(
			mapMatchPhaseToAtmosphere("playing", {
				kickoff: true,
				overtime: true,
				scoringTeam: null,
			}),
		).toBe("overtime");
	});

	it("goal_bounce z drużyną", () => {
		expect(
			mapMatchPhaseToAtmosphere("goal_bounce", {
				kickoff: false,
				overtime: false,
				scoringTeam: "orange",
			}),
		).toBe("goal_orange");
	});
});

describe("MatchAtmosphereEngine", () => {
	it("impuls przy golu podbija particlePulse", () => {
		const engine = new MatchAtmosphereEngine();
		engine.syncFromMatchPhase("goal_bounce", {
			kickoff: false,
			overtime: false,
			scoringTeam: "blue",
			timeline: 0.5,
			timeRemainingSec: 120,
			scoreDelta: 1,
		});
		for (let i = 0; i < 12; i++) engine.update(1 / 60);
		const settled = engine.getDrive();
		expect(settled.particlePulse).toBeGreaterThan(0.7);
	});

	it("timeline rośnie z czasem meczu", () => {
		const engine = new MatchAtmosphereEngine();
		engine.syncFromMatchPhase("playing", {
			kickoff: false,
			overtime: false,
			scoringTeam: null,
			timeline: 0.85,
			timeRemainingSec: 40,
			scoreDelta: 0,
		});
		for (let i = 0; i < 60; i++) engine.update(1 / 60);
		const drive = engine.getDrive();
		expect(drive.timeline).toBeCloseTo(0.85, 2);
		expect(drive.neonLineBoost).toBeGreaterThan(0.6);
	});

	it("countdown → rally zmienia fazę", () => {
		const engine = new MatchAtmosphereEngine();
		engine.syncFromMatchPhase("countdown", {
			kickoff: false,
			overtime: false,
			scoringTeam: null,
			timeline: 0,
			timeRemainingSec: 300,
			scoreDelta: 0,
		});
		engine.update(0.1);
		expect(engine.getPhase()).toBe("countdown");

		engine.syncFromMatchPhase("playing", {
			kickoff: false,
			overtime: false,
			scoringTeam: null,
			timeline: 0.02,
			timeRemainingSec: 295,
			scoreDelta: 0,
		});
		expect(engine.getPhase()).toBe("rally");
	});
});
