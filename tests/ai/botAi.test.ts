import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { AIManager } from "../../src/ai/AIManager";
import { BotBehavior, computeAnalogSteer, computeIntercept, vectorSteer } from "../../src/ai/BotBehavior";
import {
	assignBotRolesFFA,
	assignBotRolesForTeam,
	ballThreatensOwnGoal,
	isBallAirborne,
	isBallIdle,
	isLooseBall,
	isBehindBall,
	isBetweenBallAndGoal,
	shouldJumpForBall,
	shouldRepositionAroundBall,
} from "../../src/ai/botTactics";
import { RL_ARENA } from "../../src/visual/arenaConstants";
import {
	createTestCar,
	createTestScene,
	expectedHoverCenterY,
	MockControlInput,
	simulateFrames,
} from "../physics/harness";

vi.mock("../../src/debug/config", () => ({
	HOVER_SAFE_MODE: false,
	HOVER_DEBUG_RAYS: false,
	HOVER_FORCE_MAX: 50_000,
	HOVER_TELEMETRY_EVERY_STEPS: 0,
	DEBUG_AUTOPILOT: false,
	AUTOPILOT_DURATION_SEC: 20,
}));

describe("botTactics", () => {
	const ball = new THREE.Vector3(0, 1, 0);
	const enemyGoal = new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH);

	it("isBehindBall — bot za piłką względem bramki", () => {
		const bot = new THREE.Vector3(0, 0, -12);
		expect(isBehindBall(bot, ball, enemyGoal)).toBe(true);
	});

	it("isBetweenBallAndGoal — bot przed piłką blokuje strzał", () => {
		const bot = new THREE.Vector3(0, 0, 6);
		expect(isBetweenBallAndGoal(bot, ball, enemyGoal)).toBe(true);
	});

	it("isLooseBall — powolny toczeń też traktowany jak wolna piłka", () => {
		expect(isLooseBall(new THREE.Vector3(0, 0, 1.8))).toBe(true);
		expect(isLooseBall(new THREE.Vector3(0, 0, 5))).toBe(false);
	});

	it("isBallAirborne — odrzuca niski odbiór, akceptuje prawdziwy lot", () => {
		const lowBounce = new THREE.Vector3(0, 1.1, 0);
		const lowVel = new THREE.Vector3(0, 0.2, 4);
		expect(isBallAirborne(lowBounce, lowVel)).toBe(false);

		const rising = new THREE.Vector3(0, 1.95, 0);
		const upVel = new THREE.Vector3(0, 0.7, 2);
		expect(isBallAirborne(rising, upVel)).toBe(true);

		const highHang = new THREE.Vector3(0, 2.5, 0);
		const fallVel = new THREE.Vector3(0, -1, 0);
		expect(isBallAirborne(highHang, fallVel)).toBe(true);
	});

	it("shouldRepositionAroundBall — nie z daleka przy leżącej piłce", () => {
		const ballPos = new THREE.Vector3(0, 0.5, 0);
		const ballVel = new THREE.Vector3(0, 0, 0);
		const spawnBot = new THREE.Vector3(0, 0, 22);
		expect(isBallIdle(ballVel)).toBe(true);
		expect(
			shouldRepositionAroundBall(
				spawnBot,
				ballPos,
				ballVel,
				enemyGoal,
				20,
			),
		).toBe(false);
	});

	it("shouldRepositionAroundBall — blisko i piłka w ruchu", () => {
		const ballPos = new THREE.Vector3(0, 0.5, 0);
		const ballVel = new THREE.Vector3(0, 0, 8);
		const closeBot = new THREE.Vector3(0, 0, 6);
		expect(
			shouldRepositionAroundBall(
				closeBot,
				ballPos,
				ballVel,
				enemyGoal,
				20,
			),
		).toBe(true);
	});

	it("ballThreatensOwnGoal — piłka leci w bramkę", () => {
		const ownGoal = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);
		const flying = new THREE.Vector3(0, 2, -10);
		const vel = new THREE.Vector3(0, 0, -12);
		expect(ballThreatensOwnGoal(flying, vel, ownGoal)).toBe(true);
	});

	it("shouldJumpForBall — obrona przy wysokiej piłce", () => {
		const ownGoal = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);
		const botPos = new THREE.Vector3(0, 0, -8);
		const botForward = new THREE.Vector3(0, 0, -1);
		const ballPos = new THREE.Vector3(0, 2.2, -6);
		const ballVel = new THREE.Vector3(0, 0, -10);
		expect(
			shouldJumpForBall(
				botPos,
				botForward,
				ballPos,
				ballVel,
				enemyGoal,
				ownGoal,
				{ role: "goalie", clearanceActive: true },
			),
		).toBe(true);
	});

	it("shouldJumpForBall — striker nie skacze przy niskim toczeniu", () => {
		const ownGoal = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);
		const botPos = new THREE.Vector3(0, 0, 10);
		const botForward = new THREE.Vector3(0, 0, 1);
		const ballPos = new THREE.Vector3(0, 0.95, 12);
		const ballVel = new THREE.Vector3(0, 0.1, 5);
		expect(
			shouldJumpForBall(
				botPos,
				botForward,
				ballPos,
				ballVel,
				enemyGoal,
				ownGoal,
				{ role: "striker" },
			),
		).toBe(false);
	});

	it("shouldJumpForBall — striker skacze do lobu", () => {
		const ownGoal = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);
		const botPos = new THREE.Vector3(0, 0, 10);
		const botForward = new THREE.Vector3(0, 0, 1);
		const ballPos = new THREE.Vector3(0, 2.3, 12);
		const ballVel = new THREE.Vector3(0, 0.6, 4);
		expect(
			shouldJumpForBall(
				botPos,
				botForward,
				ballPos,
				ballVel,
				enemyGoal,
				ownGoal,
				{ role: "striker" },
			),
		).toBe(true);
	});

	it("assignBotRolesForTeam — 1v1 jedyny bot zawsze striker", () => {
		const roles = assignBotRolesForTeam(
			[
				{ slotIndex: 0, distToIntercept: 5, isHuman: true },
				{ slotIndex: 1, distToIntercept: 20, isHuman: false },
			],
			1,
		);
		expect(roles.get(1)).toBe("striker");
	});

	it("assignBotRolesForTeam — 2v2 ally: goalie przy spawn center_back", () => {
		const roles = assignBotRolesForTeam(
			[
				{ slotIndex: 0, distToIntercept: 4, isHuman: true },
				{
					slotIndex: 1,
					distToIntercept: 18,
					isHuman: false,
					spawnRole: "center_back",
				},
			],
			2,
		);
		expect(roles.get(1)).toBe("goalie");
	});

	it("assignBotRolesForTeam — 2v2: offensive_corner bot zostaje striker", () => {
		const roles = assignBotRolesForTeam(
			[
				{ slotIndex: 0, distToIntercept: 4, isHuman: true },
				{
					slotIndex: 2,
					distToIntercept: 18,
					isHuman: false,
					spawnRole: "offensive_corner",
				},
			],
			2,
		);
		expect(roles.get(2)).toBe("striker");
	});

	it("assignBotRolesFFA — rozdziela striker/support", () => {
		const intercepts = new Map<number, THREE.Vector3>();
		const peers = [
			{ slotIndex: 1, position: new THREE.Vector3(-5, 0, -10), isHuman: false },
			{ slotIndex: 2, position: new THREE.Vector3(5, 0, -10), isHuman: false },
			{ slotIndex: 3, position: new THREE.Vector3(0, 0, 20), isHuman: false },
			{ slotIndex: 0, position: new THREE.Vector3(0, 0, -5), isHuman: true },
		];
		for (const p of peers) {
			intercepts.set(p.slotIndex, new THREE.Vector3(0, 1, 0));
		}
		const roles = assignBotRolesFFA(peers, intercepts);
		expect(roles.get(1)).toBe("striker");
		expect(roles.get(3)).toBe("support");
	});
});

describe("computeIntercept", () => {
	it("przewiduje pozycję piłki z wyprzedzeniem", () => {
		const ballPos = new THREE.Vector3(0, 1, 0);
		const ballVel = new THREE.Vector3(0, 0, 10);
		const botPos = new THREE.Vector3(0, 0, -20);
		const out = computeIntercept(ballPos, ballVel, botPos);
		expect(out.z).toBeGreaterThan(ballPos.z);
	});
});

describe("AIManager", () => {
	it("beginFrame przypisuje striker botowi w 1v1", () => {
		const ai = new AIManager();
		ai.registerBot(1, "orange");

		ai.beginFrame(
			{
				ballPos: new THREE.Vector3(0, 1, 0),
				ballVel: new THREE.Vector3(),
				kickoffActive: false,
				kickoffCountdown: false,
				kickoffDriveLocked: false,
				carsFrozen: false,
				isFFA: false,
				teamSize: 1,
				peers: [
					{ slotIndex: 0, team: "blue", position: new THREE.Vector3(0, 0, -30), isHuman: true },
					{ slotIndex: 1, team: "orange", position: new THREE.Vector3(0, 0, 30), isHuman: false },
				],
			},
			1 / 60,
		);

		expect(ai.getRole(1)).toBe("striker");
	});
});

describe("BotBehavior — integracja fizyki", () => {
	it("think — striker jedzie do leżącej piłki ze spawnu", () => {
		const scene = createTestScene();
		const car = createTestCar(scene);
		car.resetKickoffPose(0, expectedHoverCenterY(), 22, Math.PI);
		simulateFrames(scene, car, new MockControlInput(), 30);

		const behavior = new BotBehavior("orange", 1);
		const drive = behavior.think(
			car,
			"striker",
			{
				ballPos: new THREE.Vector3(0, 0.5, 0),
				ballVel: new THREE.Vector3(0, 0, 0),
				intercept: new THREE.Vector3(0, 0.5, 0),
				kickoffActive: false,
				kickoffCountdown: false,
				kickoffDriveLocked: false,
				carsFrozen: false,
				isFFA: false,
				teamSize: 1,
				peers: [],
			},
			null,
			1 / 60,
		);

		expect(drive.forward).toBeGreaterThan(0);
	});

	it("think — striker jedzie do przodu w stronę piłki", () => {
		const scene = createTestScene();
		const car = createTestCar(scene);
		car.resetKickoffPose(0, expectedHoverCenterY(), -20, 0);
		simulateFrames(scene, car, new MockControlInput(), 60);

		const behavior = new BotBehavior("orange", 1);
		const drive = behavior.think(
			car,
			"striker",
			{
				ballPos: new THREE.Vector3(0, 1, 0),
				ballVel: new THREE.Vector3(),
				intercept: new THREE.Vector3(0, 1, 0),
				kickoffActive: false,
				carsFrozen: false,
				isFFA: false,
				teamSize: 1,
				peers: [],
			},
			null,
			1 / 60,
		);

		expect(drive.forward).toBeGreaterThan(0);
	});

	it("vectorSteer kieruje do celu przed maską", () => {
		const scene = createTestScene();
		const car = createTestCar(scene);
		car.resetKickoffPose(0, 1.4, -10, 0);

		const steer = vectorSteer(new THREE.Vector3(0, 0, 20), car);
		expect(steer.forward).toBeGreaterThan(0);
	});

	it("computeAnalogSteer daje częściowy skręt zamiast pełnego ±1", () => {
		const scene = createTestScene();
		const car = createTestCar(scene);
		car.resetKickoffPose(0, 1.4, 0, 0);

		const steer = computeAnalogSteer(new THREE.Vector3(2, 0, 40), car);
		expect(steer.forward).toBeGreaterThan(0.3);
		expect(Math.abs(steer.yaw)).toBeGreaterThan(0.05);
		expect(Math.abs(steer.yaw)).toBeLessThan(0.75);
	});
});
