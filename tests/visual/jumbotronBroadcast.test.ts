import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
	BROADCAST_RT,
	BROADCAST_SHOT_MS,
	BROADCAST_SHOT_ORDER,
	sampleBroadcastShot,
} from "../../src/visual/jumbotronBroadcast";
import {
	FILM_OFF_MS,
	FILM_ON_MS,
	LIVE_ON_MS,
} from "../../src/visual/jumbotronFeed";

describe("jumbotron broadcast shots", () => {
	it("ma czytelne rzuty TV (bez endzone / goal-line)", () => {
		expect(BROADCAST_SHOT_ORDER.length).toBeGreaterThanOrEqual(6);
		expect(BROADCAST_SHOT_ORDER).toContain("highWide");
		expect(BROADCAST_SHOT_ORDER).toContain("sideline");
		expect(BROADCAST_SHOT_ORDER).toContain("pressBox");
		expect(BROADCAST_SHOT_ORDER).toContain("tactical");
		expect(BROADCAST_SHOT_ORDER).toContain("teleBall");
		expect(BROADCAST_SHOT_ORDER).toContain("elevatedFollow");
		expect(BROADCAST_SHOT_ORDER).not.toContain("endzoneBlue");
		expect(BROADCAST_SHOT_ORDER).not.toContain("endzoneOrange");
		expect(BROADCAST_SHOT_ORDER).not.toContain("goalLine");
	});

	it("cięcia kamer trwają kilka sekund", () => {
		expect(BROADCAST_SHOT_MS[0]).toBeGreaterThanOrEqual(3_000);
		expect(BROADCAST_SHOT_MS[1]).toBeLessThanOrEqual(8_000);
		expect(BROADCAST_SHOT_MS[0]).toBeLessThan(BROADCAST_SHOT_MS[1]);
	});

	it("RT jumbotronu jest lekkie (LED scale)", () => {
		expect(BROADCAST_RT.w).toBeLessThanOrEqual(640);
		expect(BROADCAST_RT.h).toBeLessThanOrEqual(360);
		expect(BROADCAST_RT.w / BROADCAST_RT.h).toBeCloseTo(16 / 9, 1);
	});

	it("sampleBroadcastShot: oko wysoko, z bandy, nie zza bramki", () => {
		const eye = new THREE.Vector3();
		const look = new THREE.Vector3();
		const ball = new THREE.Vector3(5, 2, -10);
		const halfW = 41;
		const halfL = 51.2;
		const maxEndZ = halfL * 0.72;
		for (const id of BROADCAST_SHOT_ORDER) {
			const fov = sampleBroadcastShot(id, ball, halfW, halfL, 1, eye, look);
			expect(fov).toBeGreaterThan(30);
			expect(fov).toBeLessThan(75);
			expect(Number.isFinite(eye.x)).toBe(true);
			expect(Number.isFinite(look.z)).toBe(true);
			expect(eye.y).toBeGreaterThanOrEqual(9.5);
			expect(Math.abs(eye.z)).toBeLessThanOrEqual(maxEndZ + 0.05);
			/** tactical może być bliżej osi X; reszta z zewnątrz bandy */
			if (id !== "tactical") {
				expect(Math.abs(eye.x)).toBeGreaterThanOrEqual(halfW + 2.4);
			}
		}
	});
});

describe("jumbotron feed slot timing (LED / LIVE / film)", () => {
	it("LIVE i film są krótsze niż LED idle", () => {
		expect(LIVE_ON_MS[0]).toBeGreaterThanOrEqual(10_000);
		expect(LIVE_ON_MS[1]).toBeLessThanOrEqual(30_000);
		expect(FILM_ON_MS[1]).toBeLessThanOrEqual(FILM_OFF_MS[0]);
		expect(LIVE_ON_MS[1]).toBeLessThanOrEqual(FILM_OFF_MS[1]);
	});
});
