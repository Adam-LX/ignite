import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { MatchController } from "../../src/modes/MatchController";

describe("MatchController — online forfeit", () => {
	it("applyOnlineForfeit kończy mecz 3–0 i oznacza poddanie", () => {
		const match = new MatchController(new THREE.Scene(), "1v1");
		match.applyOnlineForfeit(1);
		expect(match.getPhase()).toBe("finished");
		expect(match.wasForfeit()).toBe(true);
		const snap = match.getHudSnapshot([]);
		expect(snap.blueScore).toBe(3);
		expect(snap.orangeScore).toBe(0);
	});

	it("drugi forfeit jest ignorowany", () => {
		const match = new MatchController(new THREE.Scene(), "1v1");
		match.applyOnlineForfeit(0);
		match.applyOnlineForfeit(1);
		const snap = match.getHudSnapshot([]);
		expect(snap.blueScore).toBe(0);
		expect(snap.orangeScore).toBe(3);
	});
});
