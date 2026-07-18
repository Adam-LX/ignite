import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { MatchController } from "../../src/modes/MatchController";

const FRAME_DT = 1 / 60;

type MatchInternals = {
	phase: string;
	finishAfterGoal: boolean;
	kickoffIgniteLeft: number;
	goalCelebrationLeft: number;
	countdownLeft: number;
};

function internals(match: MatchController): MatchInternals {
	return match as unknown as MatchInternals;
}

describe("MatchController — golden goal", () => {
	it("advanceCountdown kończy mecz gdy finishAfterGoal (nie wraca do playing)", () => {
		const match = new MatchController(new THREE.Scene(), "1v1");
		const m = internals(match);
		m.phase = "goal_pause";
		m.finishAfterGoal = true;
		m.kickoffIgniteLeft = 0.001;

		match.advanceCountdown(FRAME_DT);

		expect(match.getPhase()).toBe("finished");
	});

	it("finishReplay po golu w dogrywce → pauza golden goal, bez kickoffu", () => {
		const match = new MatchController(new THREE.Scene(), "1v1");
		const m = internals(match);
		m.phase = "goal_replay";
		m.finishAfterGoal = true;

		match.finishReplay();

		expect(match.getPhase()).toBe("goal_pause");
		expect(m.goalCelebrationLeft).toBeGreaterThan(0);
		expect(m.countdownLeft).toBe(0);
		expect(m.kickoffIgniteLeft).toBe(0);
	});
});
