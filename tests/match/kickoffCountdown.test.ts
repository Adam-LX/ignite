import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { MATCH_RULES } from "../../src/game/modes";
import { MatchController } from "../../src/modes/MatchController";

const FRAME_DT = 1 / 60;

describe("MatchController — kickoff countdown", () => {
	it("przechodzi 3…2…1 → IGNITE → playing", () => {
		const scene = new THREE.Scene();
		const match = new MatchController(scene, "1v1");

		expect(match.isKickoffCountdownActive()).toBe(true);

		const ticks = new Set<number>();
		let sawIgnite = false;
		let elapsed = 0;

		while (match.isKickoffCountdownActive() && elapsed < 12) {
			const snap = match.getHudSnapshot([]);
			if (snap.kickoffTick !== null) ticks.add(snap.kickoffTick);
			if (snap.kickoffIgnite) sawIgnite = true;
			match.advanceCountdown(FRAME_DT);
			elapsed += FRAME_DT;
		}

		const final = match.getHudSnapshot([]);
		expect(sawIgnite).toBe(true);
		expect(ticks.has(MATCH_RULES.countdownSec)).toBe(true);
		expect(final.phase).toBe("playing");
		expect(match.isCarsFrozen()).toBe(false);
	});

	it("nie zamraża aut podczas odliczania", () => {
		const scene = new THREE.Scene();
		const match = new MatchController(scene, "1v1");
		while (match.isKickoffCountdownActive()) {
			expect(match.isCarsFrozen()).toBe(false);
			match.advanceCountdown(FRAME_DT);
		}
	});

	it("blokuje jazdę podczas 5…1, nie podczas IGNITE", () => {
		const scene = new THREE.Scene();
		const match = new MatchController(scene, "1v1");

		expect(match.isKickoffDriveLocked()).toBe(true);
		expect(match.getHudSnapshot([]).kickoffTick).not.toBeNull();

		while (match.getHudSnapshot([]).kickoffTick !== null) {
			expect(match.isKickoffDriveLocked()).toBe(true);
			match.advanceCountdown(FRAME_DT);
		}

		expect(match.getHudSnapshot([]).kickoffIgnite).toBe(true);
		expect(match.isKickoffDriveLocked()).toBe(false);
	});
});
