import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	isKickoffChasePhase,
	shouldChaseKickoffBall,
} from "../../src/ai/botTactics";

describe("botTactics — kickoff", () => {
	it("isKickoffChasePhase — aktywny kickoff lub piłka na środku", () => {
		const center = new THREE.Vector3(0, 0.92, 0);
		const still = new THREE.Vector3(0, 0, 0);
		expect(isKickoffChasePhase(center, still, true, 0)).toBe(true);
		expect(isKickoffChasePhase(center, still, false, 0.2)).toBe(true);
		expect(isKickoffChasePhase(center, still, false, 0)).toBe(true);
	});

	it("isKickoffChasePhase — odrzuca piłkę daleko od centrum w ruchu", () => {
		const far = new THREE.Vector3(12, 0.92, 8);
		const moving = new THREE.Vector3(4, 0, 3);
		expect(isKickoffChasePhase(far, moving, false, 0)).toBe(false);
	});

	it("shouldChaseKickoffBall — striker/support w dużym składzie", () => {
		expect(shouldChaseKickoffBall("striker", false, 3)).toBe(true);
		expect(shouldChaseKickoffBall("support", false, 3)).toBe(true);
		expect(shouldChaseKickoffBall("goalie", false, 3)).toBe(false);
		expect(shouldChaseKickoffBall("goalie", false, 1)).toBe(true);
	});
});
