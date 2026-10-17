import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { MatchController, PODIUM_SKIP_GRACE_SEC } from "../../src/modes/MatchController";

describe("MatchController — podium flow", () => {
	it("forfeit → podium timer → finished after skip", () => {
		const match = new MatchController(new THREE.Scene(), "1v1");
		match.applyOnlineForfeit(0);
		expect(match.getPhase()).toBe("podium");
		const left = match.getPodiumLeftSec();
		expect(left).not.toBeNull();
		expect(left!).toBeGreaterThan(5);
		expect(PODIUM_SKIP_GRACE_SEC).toBeLessThan(left!);

		const ball = {
			rapierRigidBody: {
				setLinvel() {},
				setAngvel() {},
				setTranslation() {},
				translation: () => ({ x: 0, y: 1, z: 0 }),
			},
		};
		match.skipPodium([], ball as never);
		expect(match.getPhase()).toBe("finished");
		expect(match.getPodiumLeftSec()).toBeNull();
	});

	it("podium expires to finished without skip", () => {
		const match = new MatchController(new THREE.Scene(), "1v1");
		match.applyOnlineForfeit(1);
		const ball = {
			rapierRigidBody: {
				setLinvel() {},
				setAngvel() {},
				setTranslation() {},
				translation: () => ({ x: 0, y: 1, z: 0 }),
			},
		};
		match.update(12, null as never, ball as never, [], 0.92, 0.36);
		expect(match.getPhase()).toBe("finished");
		expect(match.getPodiumLeftSec()).toBeNull();
	});
});
