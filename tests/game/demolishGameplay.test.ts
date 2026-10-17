import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
	DEMO_CAM_TRANSITION_SEC,
	DEMO_RESPAWN_SEC,
	DEMO_SPAWN_INVULN_SEC,
	evaluateDemolish,
} from "../../src/game/demolishGameplay";
import { SUPERSONIC_MPS } from "../../src/visual/supersonicBreak";

function mockPlayer(opts: {
	pos: THREE.Vector3;
	vel: THREE.Vector3;
	fwd?: THREE.Vector3;
	demo?: boolean;
	invuln?: boolean;
}) {
	return {
		getPosition: () => opts.pos.clone(),
		getVelocity: () => opts.vel.clone(),
		getForward: () => (opts.fwd ?? new THREE.Vector3(0, 0, 1)).clone(),
		isDemolished: () => !!opts.demo,
		isDemoInvulnerable: () => !!opts.invuln,
	};
}

describe("evaluateDemolish", () => {
	it("requires near-supersonic forward speed", () => {
		const attacker = mockPlayer({
			pos: new THREE.Vector3(0, 1, 0),
			vel: new THREE.Vector3(0, 0, 12),
			fwd: new THREE.Vector3(0, 0, 1),
		});
		const victim = mockPlayer({
			pos: new THREE.Vector3(0, 1, 3),
			vel: new THREE.Vector3(0, 0, 0),
		});
		expect(evaluateDemolish(attacker as never, victim as never)).toBe(false);
	});

	it("passes at SS into victim nose", () => {
		const attacker = mockPlayer({
			pos: new THREE.Vector3(0, 1, 0),
			vel: new THREE.Vector3(0, 0, SUPERSONIC_MPS),
			fwd: new THREE.Vector3(0, 0, 1),
		});
		const victim = mockPlayer({
			pos: new THREE.Vector3(0, 1, 2.5),
			vel: new THREE.Vector3(0, 0, 0),
		});
		expect(evaluateDemolish(attacker as never, victim as never)).toBe(true);
	});

	it("blocks same-team without friendly fire", () => {
		const attacker = mockPlayer({
			pos: new THREE.Vector3(0, 1, 0),
			vel: new THREE.Vector3(0, 0, SUPERSONIC_MPS),
			fwd: new THREE.Vector3(0, 0, 1),
		});
		const victim = mockPlayer({
			pos: new THREE.Vector3(0, 1, 2.5),
			vel: new THREE.Vector3(0, 0, 0),
		});
		expect(
			evaluateDemolish(attacker as never, victim as never, {
				sameTeam: true,
				friendlyFire: false,
			}),
		).toBe(false);
	});

	it("blocks already demolished / invulnerable victim", () => {
		const attacker = mockPlayer({
			pos: new THREE.Vector3(0, 1, 0),
			vel: new THREE.Vector3(0, 0, SUPERSONIC_MPS),
			fwd: new THREE.Vector3(0, 0, 1),
		});
		const victim = mockPlayer({
			pos: new THREE.Vector3(0, 1, 2.5),
			vel: new THREE.Vector3(0, 0, 0),
			invuln: true,
		});
		expect(evaluateDemolish(attacker as never, victim as never)).toBe(false);
	});

	it("rejects side swipe (nose not toward victim)", () => {
		const attacker = mockPlayer({
			pos: new THREE.Vector3(0, 1, 0),
			vel: new THREE.Vector3(0, 0, SUPERSONIC_MPS),
			fwd: new THREE.Vector3(0, 0, 1),
		});
		const victim = mockPlayer({
			pos: new THREE.Vector3(3, 1, 0.5),
			vel: new THREE.Vector3(0, 0, 0),
		});
		expect(evaluateDemolish(attacker as never, victim as never)).toBe(false);
	});

	it("exports RL respawn duration", () => {
		expect(DEMO_RESPAWN_SEC).toBe(3);
		/** Pro demo cam transition ~0 — Ignite keeps short death→spawn dolly. */
		expect(DEMO_CAM_TRANSITION_SEC).toBeLessThanOrEqual(0.75);
		expect(DEMO_CAM_TRANSITION_SEC).toBeGreaterThan(0);
		expect(DEMO_SPAWN_INVULN_SEC).toBeGreaterThan(0.5);
		expect(DEMO_SPAWN_INVULN_SEC).toBeLessThan(1.5);
	});
});

describe("demo→chase soft handoff contract", () => {
	it("Renderer ma handoffDemoToChase zamiast twardego snap po respawnie", () => {
		const renderer = readFileSync(
			resolve(__dirname, "../../src/Renderer.ts"),
			"utf8",
		);
		const session = readFileSync(
			resolve(__dirname, "../../src/game/GameSession.ts"),
			"utf8",
		);
		expect(renderer).toContain("handoffDemoToChase");
		expect(session).toContain("handoffDemoToChase");
		expect(session).not.toMatch(
			/endDemoRespawnCam\(\);\s*deps\.renderer\.snapChaseCamera/,
		);
		const hi = renderer.indexOf("handoffDemoToChase(");
		expect(hi).toBeGreaterThan(0);
		const handoff = renderer.slice(hi, hi + 900);
		expect(handoff).not.toMatch(/ballCamBlendT\s*=/);
	});
});
