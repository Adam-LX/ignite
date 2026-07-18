import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { BotBehavior } from "../../src/ai/BotBehavior";
import {
	IGNITION_BALANCE,
	ignitionPickIntervalSec,
	IgnitionManager,
} from "../../src/modes/IgnitionManager";
import { RL_ARENA } from "../../src/visual/arenaConstants";

function mockBall(pos = { x: 0, y: 0.92, z: 0 }) {
	return {
		getPosition: () => pos,
		rapierRigidBody: {
			applyImpulse: () => {},
			linvel: () => ({ x: 0, y: 0, z: 0 }),
			setTranslation: () => {},
			setLinvel: () => {},
			setAngvel: () => {},
		},
	} as never;
}

function mockPlayer(
	pos: THREE.Vector3,
	forward = new THREE.Vector3(0, 0, 1),
) {
	return {
		getPosition: () => pos,
		getForward: () => forward.clone(),
		getUpward: () => new THREE.Vector3(0, 1, 0),
		getVelocity: () => new THREE.Vector3(0, 0, 12),
		getBoostFuel: () => 1,
		isOnGround: () => true,
		getWheelsGroundedCount: () => 4,
		getSurfaceNormal: () => new THREE.Vector3(0, 1, 0),
		updateInputs: () => {},
	} as never;
}

function behaviorCtx(
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
): {
	ballPos: THREE.Vector3;
	ballVel: THREE.Vector3;
	kickoffActive: boolean;
	kickoffCountdown: boolean;
	kickoffDriveLocked: boolean;
	carsFrozen: boolean;
	isFFA: boolean;
	teamSize: number;
	peers: [];
} {
	return {
		ballPos,
		ballVel,
		kickoffActive: false,
		kickoffCountdown: false,
		kickoffDriveLocked: false,
		carsFrozen: false,
		isFFA: false,
		teamSize: 1,
		peers: [],
	};
}

describe("IgnitionManager — bot aktywacja", () => {
	it("spikes — aktywuje w zasięgu chwytu", () => {
		const mgr = new IgnitionManager(true);
		mgr.registerSlot(0);
		mgr.forceHeldForTests(0, "spikes");
		const ball = mockBall({ x: 0, y: 0.92, z: 2 });
		mgr.bindBall(ball);

		const pos = new THREE.Vector3(0, 0, 0);
		const player = mockPlayer(pos);
		const ctx = behaviorCtx(
			new THREE.Vector3(0, 0.92, 2),
			new THREE.Vector3(0, 0, 0),
		);

		const used = mgr.tryBotActivate(0, player, "blue", "striker", "ALIGN_SHOT", ctx);
		expect(used).toBe(true);
		expect(mgr.hasSpikesGrip(0)).toBe(true);
	});

	it("spikes — miss nie konsumuje picka i nie zostawia stuck activeKind", () => {
		const mgr = new IgnitionManager(true);
		mgr.registerSlot(0);
		mgr.forceHeldForTests(0, "spikes");
		const ball = mockBall({ x: 0, y: 0.92, z: 20 });
		mgr.bindBall(ball);

		const used = mgr.tryHumanActivate(
			0,
			mockPlayer(new THREE.Vector3(0, 0, 0)),
			"blue",
			false,
		);
		expect(used).toBe(false);
		const hud = mgr.getHudState(0);
		expect(hud.held).toBe("spikes");
		expect(hud.activeKind).toBeNull();
		expect(mgr.hasPowerUpEngaged(0)).toBe(true);
	});

	it("plunger — obrona gdy piłka leci w naszą bramkę", () => {
		const mgr = new IgnitionManager(true);
		mgr.registerSlot(0);
		mgr.forceHeldForTests(0, "plunger");
		const ball = mockBall({ x: 0, y: 0.92, z: -RL_ARENA.HALF_LENGTH + 8 });
		mgr.bindBall(ball);

		const pos = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH + 14);
		const player = mockPlayer(pos, new THREE.Vector3(0, 0, -1));
		const ctx = behaviorCtx(
			new THREE.Vector3(0, 0.92, -RL_ARENA.HALF_LENGTH + 8),
			new THREE.Vector3(0, 0, -12),
		);

		const used = mgr.tryBotActivate(0, player, "blue", "striker", "DEFEND", ctx);
		expect(used).toBe(true);
		expect(mgr.getHudState(0).activeKind).toBe("plunger");
	});

	it("magnet — loose ball w połowie ataku", () => {
		const mgr = new IgnitionManager(true);
		mgr.registerSlot(0);
		mgr.forceHeldForTests(0, "magnet");
		const ball = mockBall({ x: 0, y: 0.92, z: 12 });
		mgr.bindBall(ball);

		const pos = new THREE.Vector3(0, 0, 22);
		const player = mockPlayer(pos);
		const ctx = behaviorCtx(
			new THREE.Vector3(0, 0.92, 28),
			new THREE.Vector3(0.5, 0, 0.5),
		);

		const used = mgr.tryBotActivate(0, player, "blue", "striker", "ALIGN_SHOT", ctx);
		expect(used).toBe(true);
		expect(mgr.getHudState(0).activeKind).toBe("magnet");
	});

	it("ignition1v1 — boty aktywują power-upy (v0.0.82)", () => {
		const mgr = new IgnitionManager(true, { botsUsePowerUps: true });
		mgr.registerSlot(1);
		mgr.forceHeldForTests(1, "spikes");
		mgr.bindBall(mockBall({ x: 0, y: 0.92, z: 1.5 }));

		const used = mgr.tryBotActivate(
			1,
			mockPlayer(new THREE.Vector3(0, 0, 0)),
			"orange",
			"striker",
			"ALIGN_SHOT",
			behaviorCtx(new THREE.Vector3(0, 0.92, 1.5), new THREE.Vector3()),
		);
		expect(used).toBe(true);
		expect(mgr.hasSpikesGrip(1)).toBe(true);
	});

	it("haymaker — striker przy piłce w kierunku bramki", () => {
		const mgr = new IgnitionManager(true);
		mgr.registerSlot(0);
		mgr.forceHeldForTests(0, "haymaker");
		const ball = mockBall({ x: 0, y: 0.92, z: 18 });
		mgr.bindBall(ball);

		const pos = new THREE.Vector3(0, 0, 14);
		const player = mockPlayer(pos, new THREE.Vector3(0, 0, 1));
		const ctx = behaviorCtx(
			new THREE.Vector3(0, 0.92, 18),
			new THREE.Vector3(0, 0, 2),
		);

		const used = mgr.tryBotActivate(0, player, "blue", "striker", "ALIGN_SHOT", ctx);
		expect(used).toBe(true);
	});

	it("IGNITION_BALANCE — stałe czasów (M3 / Gemini)", () => {
		expect(IGNITION_BALANCE.pickIntervalBaseSec).toBe(13);
		expect(IGNITION_BALANCE.spikesHoldSec).toBe(4);
		expect(IGNITION_BALANCE.spikesGrabRadius).toBe(3);
		expect(ignitionPickIntervalSec(8)).toBe(17);
		expect(ignitionPickIntervalSec(2)).toBe(14);
	});
});

describe("BotBehavior — spikes rush", () => {
	it("forceSpikesRush — pełny gaz w stronę bramki", () => {
		const bot = new BotBehavior("blue", 0);
		bot.forceSpikesRush();

		const player = mockPlayer(new THREE.Vector3(0, 0, -20));
		const ctx = behaviorCtx(
			new THREE.Vector3(0, 0.92, 0),
			new THREE.Vector3(0, 0, 0),
		);

		const drive = bot.think(player, "striker", ctx, null, 1 / 60);
		expect(drive.forward).toBeGreaterThan(0.5);
		expect(drive.boost).toBe(true);
	});
});
