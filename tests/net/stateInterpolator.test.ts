import { describe, expect, it } from "vitest";

import {
	extrapolateSnapshot,
	StateInterpolator,
} from "../../src/net/StateInterpolator";
import { NETCODE } from "../../src/net/netcodeTuning";
import type { WorldSnapshotPayload } from "../../src/net/protocol";

function makeSnapshot(
	tick: number,
	serverTimeMs: number,
	ballX = 0,
	ballVx = 10,
): WorldSnapshotPayload {
	return {
		tick,
		serverTimeMs,
		ball: {
			pos: { x: ballX, y: 1, z: 0 },
			quat: { x: 0, y: 0, z: 0, w: 1 },
			linvel: { x: ballVx, y: 0, z: 0 },
			angvel: { x: 0, y: 0, z: 0 },
		},
		cars: [
			{
				slot: 0,
				pos: { x: 0, y: 1, z: -5 },
				quat: { x: 0, y: 0, z: 0, w: 1 },
				linvel: { x: 0, y: 0, z: 0 },
				angvel: { x: 0, y: 0, z: 0 },
				boost: 1,
				boosting: false,
			},
		],
		match: {
			phase: "playing",
			timeRemainingSec: 200,
			blueScore: 0,
			orangeScore: 0,
			countdownSec: null,
			kickoffTick: null,
			kickoffIgnite: false,
			overtimeBanner: false,
			isOvertime: false,
			winnerLabel: null,
			replayActive: false,
			resetCountdown: null,
			goalScorerName: null,
		},
		playerStats: [],
	};
}

describe("extrapolateSnapshot", () => {
	it("przesuwa piłkę zgodnie z prędkością", () => {
		const snap = makeSnapshot(1, 1000, 0, 20);
		const out = extrapolateSnapshot(snap, 0.05);
		expect(out.ball.pos.x).toBeCloseTo(1, 2);
	});
});

describe("StateInterpolator", () => {
	it("adaptuje delay przy nieregularnych snapshotach", async () => {
		const interp = new StateInterpolator();
		interp.push(makeSnapshot(1, performance.now()));
		await new Promise((r) => setTimeout(r, 85));
		interp.push(makeSnapshot(2, performance.now()));
		await new Promise((r) => setTimeout(r, 30));
		interp.push(makeSnapshot(3, performance.now()));
		expect(interp.getJitterMs()).toBeGreaterThan(4);
		expect(interp.getInterpolationDelayMs()).toBeGreaterThanOrEqual(
			NETCODE.BASE_INTERPOLATION_DELAY_MS,
		);
	});

	it("ekstrapoluje gdy render time wyprzedza bufor", () => {
		const interp = new StateInterpolator();
		const t0 = performance.now();
		interp.push(makeSnapshot(10, t0, 0, 15));
		interp.push(makeSnapshot(11, t0 + 16, 0.25, 15));

		const delay = interp.getInterpolationDelayMs();
		const sample = interp.sample(t0 + 16 + delay + 30);
		expect(sample?.ball.pos.x).toBeGreaterThan(0.25);
	});

	it("interpoluje między dwoma snapshotami", () => {
		const interp = new StateInterpolator();
		const t0 = performance.now();
		interp.push(makeSnapshot(1, t0, 0, 0));
		interp.push(makeSnapshot(2, t0 + 16, 10, 0));

		const delay = interp.getInterpolationDelayMs();
		const mid = interp.sample(t0 + 8 + delay);
		expect(mid?.ball.pos.x).toBeGreaterThan(2);
		expect(mid?.ball.pos.x).toBeLessThan(8);
	});
});
