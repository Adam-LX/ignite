import { describe, expect, it } from "vitest";

import { MatchBanterTracker } from "../../src/audio/MatchBanterTracker";

function car(opts: {
	human?: boolean;
	x?: number;
	z?: number;
	team?: "blue" | "orange";
	upY?: number;
}) {
	const x = opts.x ?? 0;
	const z = opts.z ?? 0;
	const upY = opts.upY ?? 1;
	return {
		isHuman: opts.human,
		isBoosting: () => false,
		team: opts.team ?? "blue",
		visualTeam: opts.team ?? "blue",
		player: {
			getPosition: () => ({ x, y: 1, z }),
			getVelocity: () => ({
				x: 0,
				y: 0,
				z: 0,
				length: () => 0,
			}),
			getUpward: () => ({
				x: 0,
				y: upY,
				z: 0,
				dot: (v: { x: number; y: number; z: number }) => upY * v.y,
			}),
			getSurfaceNormal: () => ({ x: 0, y: 1, z: 0 }),
		},
	};
}

describe("MatchBanterTracker", () => {
	it("wykrywa scramble gdy 3+ auta przy piłce", () => {
		const t = new MatchBanterTracker();
		const cars = [
			car({ x: 1 }),
			car({ x: -1, team: "orange" }),
			car({ x: 0.5, z: 0.5 }),
		];
		let ev = null;
		for (let i = 0; i < 20; i++) {
			ev = t.update(0.1, { x: 0, y: 1, z: 0 }, { x: 5, y: 0, z: 0 }, cars, true, {
				humanTouched: false,
				humanImpact: 0,
				humanWhiff: false,
				blueScore: 0,
				orangeScore: 0,
			});
			if (ev === "scramble") break;
		}
		expect(ev).toBe("scramble");
	});

	it("noteHumanTouch kolejkuje pochwałę przy mocnym hicie", () => {
		const t = new MatchBanterTracker();
		t.noteHumanTouch(12);
		const ev = t.update(
			0.016,
			{ x: 0, y: 1, z: 0 },
			{ x: 1, y: 0, z: 0 },
			[car({ human: true })],
			true,
		);
		expect(ev).toBe("player_praise");
	});

	it("score_taunt przy rosnącej przewadze", () => {
		const t = new MatchBanterTracker();
		const cars = [car({ human: true })];
		const frame = {
			humanTouched: false,
			humanImpact: 0,
			humanWhiff: false,
			blueScore: 4,
			orangeScore: 0,
		};
		expect(
			t.update(0.1, { x: 0, y: 1, z: 0 }, { x: 8, y: 0, z: 0 }, cars, true, frame),
		).toBe("score_taunt");
	});
});
