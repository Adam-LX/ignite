import { describe, expect, it } from "vitest";

import {
	DEFAULT_REPLAY_PLAYBACK,
	GoalReplayPlayer,
	GoalReplayRecorder,
	lerpSnapshot,
	smoothstep,
	type ReplayFrame,
} from "../../src/game/GoalReplay";
import {
	GoalReplayPhysicsPlayer,
	type GoalReplayClipPayload,
} from "../../src/game/InputReplay";

const frameA: ReplayFrame = {
	t: 0,
	ball: {
		px: 0,
		py: 1,
		pz: 0,
		qx: 0,
		qy: 0,
		qz: 0,
		qw: 1,
		lvx: 10,
		lvy: 0,
		lvz: 0,
	},
	cars: [],
};

const frameB: ReplayFrame = {
	t: 0.1,
	ball: {
		px: 1,
		py: 1,
		pz: 0,
		qx: 0,
		qy: 0,
		qz: 0,
		qw: 1,
		lvx: 20,
		lvy: 0,
		lvz: 0,
	},
	cars: [],
};

describe("lerpSnapshot", () => {
	it("interpoluje prędkość liniową", () => {
		const mid = lerpSnapshot(frameA.ball, frameB.ball, 0.5);
		expect(mid.lvx).toBeCloseTo(15, 5);
		expect(mid.px).toBeCloseTo(0.5, 5);
	});
});

describe("GoalReplayPlayer clipTimeScale", () => {
	it("zwalnia w okolicy bramki (goalCrossTime)", () => {
		const player = new GoalReplayPlayer();
		const frames: ReplayFrame[] = [];
		for (let i = 0; i <= 80; i++) {
			frames.push({
				t: i * 0.1,
				ball: { ...frameA.ball, px: i * 0.05 },
				cars: [],
			});
		}
		player.setClip(frames, [], {
			goalCrossTime: 5.5,
			baseSpeed: 1,
			goalSlowMul: 0.1,
			goalSlowBefore: 0.5,
			goalSlowAfter: 0.5,
		});

		const scaleAtGoal = (
			player as unknown as { clipTimeScale(t: number): number }
		).clipTimeScale(5.5);
		const scaleEarly = (
			player as unknown as { clipTimeScale(t: number): number }
		).clipTimeScale(1);

		expect(scaleAtGoal).toBeLessThan(scaleEarly);
		expect(scaleAtGoal).toBeCloseTo(0.1, 2);
	});
});

describe("GoalReplayPhysicsPlayer.setClip", () => {
	it("nie nadpisuje goalCrossTime z playback gdy podany explicite", () => {
		const physics = new GoalReplayPhysicsPlayer();
		const clip: GoalReplayClipPayload = {
			anchor: frameA,
			inputs: [
				{ t: 0, slots: [] },
				{ t: 0.5, slots: [] },
				{ t: 1, slots: [] },
			],
			goalCrossTime: 0,
		};
		const ball = {
			rapierRigidBody: {
				setTranslation: () => {},
				setRotation: () => {},
				setLinvel: () => {},
				setAngvel: () => {},
			},
			threeJSGroup: {
				position: { set: () => {} },
				quaternion: { set: () => {} },
			},
		};

		physics.setClip(clip, [], ball as never, { goalCrossTime: 5.5 });
		const playback = (
			physics as unknown as { playback: typeof DEFAULT_REPLAY_PLAYBACK }
		).playback;
		expect(playback.goalCrossTime).toBe(5.5);
	});
});

describe("GoalReplayRecorder buildClip", () => {
	it("nie dokleja zamrożonych hold-klatek po końcu bufora", () => {
		const rec = new GoalReplayRecorder(12);
		const ball = {
			rapierRigidBody: {
				translation: () => ({ x: 0, y: 1, z: 0 }),
				rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
				linvel: () => ({ x: 10, y: 0, z: 20 }),
				angvel: () => ({ x: 0, y: 0, z: 0 }),
			},
		};
		for (let i = 0; i < 30; i++) {
			const z = i * 2;
			ball.rapierRigidBody.translation = () => ({ x: 0, y: 1, z });
			ball.rapierRigidBody.linvel = () => ({ x: 0, y: 0, z: 20 });
			rec.record(i * 0.05, ball as never, []);
		}
		const clip = rec.buildClip(0, 5, 1.2);
		expect(clip.length).toBeGreaterThan(2);
		const last = clip[clip.length - 1]!;
		const first = clip[0]!;
		/** Czas klipu ≈ realne klatki, nie sztuczne 5 s hold. */
		expect(last.t).toBeLessThan(2.0);
		expect(last.ball.pz).not.toBe(first.ball.pz);
	});
});

describe("smoothstep", () => {
	it("jest monotoniczny 0→1", () => {
		expect(smoothstep(0, 1, -1)).toBe(0);
		expect(smoothstep(0, 1, 2)).toBe(1);
		expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 2);
	});
});
