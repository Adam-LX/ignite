import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import GameObject from "../../GameObject";
import Scene from "../../Scene";
import Player from "../../util/Player";
import { RL_BALL } from "../../util/rlConstants";
import {
	applyCarBallHitsAll,
	snapshotBallKinematics,
	stabilizePlayerPhysics,
	updateBallPhysics,
} from "../../util/rlContacts";
import { buildArenaPhysics, detectGoalScored } from "../../visual/arena";
import { AIManager } from "../AIManager";
import { isBotStableOnWheels } from "../botRecovery";
import { BotLearning } from "./BotLearning";
import type { BotPolicy } from "./BotPolicy";

const FRAME_DT = 1 / 60;
const BALL_RADIUS = RL_BALL.radius;

type TrainCar = {
	player: Player;
	team: "blue" | "orange";
	slot: number;
	touches: number;
	aerialTouches: number;
};

export type HeadlessEpisodeResult = {
	fitness: number;
	blueGoals: number;
	orangeGoals: number;
	ballTouches: number;
	recoveryFitness?: number;
};

export type RecoveryScenario = "turtle" | "side" | "roof";

export type RecoveryEpisodeResult = {
	fitness: number;
	recovered: boolean;
	recoveryTimeSec: number;
	scenario: RecoveryScenario;
};

const RECOVERY_MATCH_BLEND = 0.7;
const RECOVERY_SUITE_BLEND = 0.3;
const RECOVERY_MAX_SEC = 4;

/** Ocena polityki na pełnym stacku BotBehavior + BotLearning (jak w grze). */
export async function evaluateBotStackEpisode(
	policy: BotPolicy,
	seconds = 18,
	seed = 0,
): Promise<HeadlessEpisodeResult> {
	return BotLearning.get().withEvalPolicy(policy, async () => {
		const stack = await runBotStackEpisode(seconds, seed);
		const recovery = await runRecoverySuite(seed);
		return {
			...stack,
			recoveryFitness: recovery.fitness,
			fitness:
				stack.fitness * RECOVERY_MATCH_BLEND +
				recovery.fitness * RECOVERY_SUITE_BLEND,
		};
	});
}

/** Ocena samego recovery — turtle / bok / dach. */
export async function evaluateRecoveryEpisode(
	policy: BotPolicy,
	scenario: RecoveryScenario,
	maxSeconds = RECOVERY_MAX_SEC,
	seed = 0,
): Promise<RecoveryEpisodeResult> {
	return BotLearning.get().withEvalPolicy(policy, () =>
		runRecoveryScenario(scenario, maxSeconds, seed),
	);
}

/** @deprecated Użyj evaluateBotStackEpisode — surowa polityka bez heurystyki. */
export async function evaluatePolicyEpisode(
	policy: BotPolicy,
	seconds = 18,
	seed = 0,
): Promise<HeadlessEpisodeResult> {
	return evaluateBotStackEpisode(policy, seconds, seed);
}

async function runBotStackEpisode(
	seconds: number,
	seed: number,
): Promise<HeadlessEpisodeResult> {
	await RAPIER.init();

	const scene = new Scene();
	buildArenaPhysics(scene.rapierWorld);

	const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS));
	const ball = new GameObject(scene, ballMesh, {
		colliderDesc: RAPIER.ColliderDesc.ball(BALL_RADIUS)
			.setRestitution(0)
			.setMass(RL_BALL.mass),
		rigidBodyDesc: RAPIER.RigidBodyDesc.dynamic()
			.setLinearDamping(RL_BALL.airLinearDamp)
			.setAngularDamping(RL_BALL.airAngularDamp)
			.setCcdEnabled(true),
	});
	ball.rapierRigidBody.setTranslation(
		{ x: 0, y: BALL_RADIUS + 0.08, z: 0 },
		false,
	);

	const cars: TrainCar[] = [
		makeCar(scene, "blue", 0, 0, -22, 0),
		makeCar(scene, "orange", 1, 0, 22, Math.PI),
	];

	const ai = new AIManager();
	ai.registerBot(0, "blue");
	ai.registerBot(1, "orange");

	let blueGoals = 0;
	let orangeGoals = 0;
	let ballTouches = 0;
	const ballPos = new THREE.Vector3();
	const ballVel = new THREE.Vector3();

	const frames = Math.floor(seconds / FRAME_DT);
	for (let f = 0; f < frames; f++) {
		ballPos.copy(ball.getPosition());
		const bv = ball.rapierRigidBody.linvel();
		ballVel.set(bv.x, bv.y, bv.z);

		const peers = cars.map((car) => ({
			slotIndex: car.slot,
			team: car.team,
			position: car.player.getPosition(),
			isHuman: false,
		}));

		const worldCtx = {
			ballPos,
			ballVel,
			kickoffActive: false,
			kickoffCountdown: false,
			kickoffDriveLocked: false,
			carsFrozen: false,
			isFFA: false,
			teamSize: 1,
			peers,
		};

		ai.beginFrame(worldCtx, FRAME_DT);

		for (const car of cars) {
			ai.think(car.slot, car.player, worldCtx, null, FRAME_DT);
		}

		snapshotBallKinematics(ball);
		scene.advancePhysics(
			FRAME_DT,
			(fd, substep, substepCount) => {
				for (const car of cars) {
					car.player.integrateHover(fd, substep, substepCount);
				}
			},
			(_fd, substep, substepCount) => {
				for (const car of cars) {
					car.player.finalizeHoverStep(substep, substepCount);
				}
			},
		);

		const hit = applyCarBallHitsAll(
			scene.rapierWorld,
			cars.map((c) => c.player),
			ball,
		);
		if (hit.impact > 0.5) {
			ballTouches++;
			for (const car of cars) {
				const d = car.player.getPosition().distanceTo(ballPos);
				if (d < 3.2) car.touches++;
				if (d < 3.4 && ballPos.y > 1.35) {
					if (!car.player.isOnGround()) car.aerialTouches++;
					else if (car.player.getVelocity().y > 1.5) car.aerialTouches += 0.5;
				}
			}
		}

		updateBallPhysics(ball, BALL_RADIUS, FRAME_DT, scene.rapierWorld);
		for (const car of cars) {
			car.player.afterPhysics(FRAME_DT);
			stabilizePlayerPhysics(car.player);
		}

		const scored = detectGoalScored(ball.getPosition(), BALL_RADIUS);
		if (scored === "blue") {
			blueGoals++;
			resetKickoff(ball, cars, seed + f);
		} else if (scored === "orange") {
			orangeGoals++;
			resetKickoff(ball, cars, seed + f);
		}
	}

	return {
		fitness: scoreEpisodeFitness(cars, blueGoals, orangeGoals, ballTouches),
		blueGoals,
		orangeGoals,
		ballTouches,
	};
}

async function runRecoverySuite(seed: number): Promise<{ fitness: number }> {
	const scenarios: RecoveryScenario[] = ["turtle", "side", "roof"];
	let total = 0;
	for (let i = 0; i < scenarios.length; i++) {
		const result = await runRecoveryScenario(
			scenarios[i]!,
			RECOVERY_MAX_SEC,
			seed + i * 313,
		);
		total += result.fitness;
	}
	return { fitness: total / scenarios.length };
}

async function runRecoveryScenario(
	scenario: RecoveryScenario,
	maxSeconds: number,
	_seed: number,
): Promise<RecoveryEpisodeResult> {
	await RAPIER.init();

	const scene = new Scene();
	const groundRb = scene.rapierWorld.createRigidBody(
		RAPIER.RigidBodyDesc.fixed(),
	);
	scene.rapierWorld.createCollider(
		RAPIER.ColliderDesc.cuboid(45, 0.1, 62),
		groundRb,
	);

	const car = makeCar(scene, "blue", 0, 0, 0, 0);
	spawnRecoveryPose(car.player, scenario);

	const ballPos = new THREE.Vector3(0, 1, 40);
	const ballVel = new THREE.Vector3();
	const ai = new AIManager();
	ai.registerBot(0, "blue");

	const frames = Math.floor(maxSeconds / FRAME_DT);
	let recovered = false;
	let recoveryTimeSec = maxSeconds;

	for (let f = 0; f < frames; f++) {
		const peers = [
			{
				slotIndex: 0,
				team: "blue" as const,
				position: car.player.getPosition(),
				isHuman: false,
			},
		];
		const worldCtx = {
			ballPos,
			ballVel,
			kickoffActive: false,
			kickoffCountdown: false,
			kickoffDriveLocked: false,
			carsFrozen: false,
			isFFA: false,
			teamSize: 1,
			peers,
		};

		ai.beginFrame(worldCtx, FRAME_DT);
		ai.think(0, car.player, worldCtx, null, FRAME_DT);

		scene.advancePhysics(
			FRAME_DT,
			(fd, substep, substepCount) => {
				car.player.integrateHover(fd, substep, substepCount);
			},
			(_fd, substep, substepCount) => {
				car.player.finalizeHoverStep(substep, substepCount);
			},
		);
		car.player.afterPhysics(FRAME_DT);
		stabilizePlayerPhysics(car.player);

		if (!recovered && isBotStableOnWheels(car.player)) {
			recovered = true;
			recoveryTimeSec = f * FRAME_DT;
		}
	}

	return {
		scenario,
		recovered,
		recoveryTimeSec,
		fitness: scoreRecoveryFitness(recovered, recoveryTimeSec, maxSeconds),
	};
}

function scoreRecoveryFitness(
	recovered: boolean,
	timeSec: number,
	maxSec: number,
): number {
	if (!recovered) return 0;
	const t = Math.max(0.35, Math.min(timeSec, maxSec));
	return 100 - ((t - 0.35) / (maxSec - 0.35)) * 80;
}

function spawnRecoveryPose(player: Player, scenario: RecoveryScenario): void {
	player.resetKickoffPose(0, 1.35, 0, 0);
	const euler = new THREE.Euler();
	switch (scenario) {
		case "turtle":
			euler.set(Math.PI, 0, 0, "YXZ");
			break;
		case "side":
			euler.set(Math.PI / 2, 0, 0, "YXZ");
			break;
		case "roof":
			euler.set(Math.PI * 0.72, 0, 0, "YXZ");
			break;
	}
	const quat = new THREE.Quaternion().setFromEuler(euler);
	player.rapierRigidBody.setRotation(
		{ x: quat.x, y: quat.y, z: quat.z, w: quat.w },
		true,
	);
	player.rapierRigidBody.setTranslation({ x: 0, y: 1.1, z: 0 }, true);
	player.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
	player.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
	player.rapierRigidBody.wakeUp();
}

function scoreEpisodeFitness(
	cars: TrainCar[],
	blueGoals: number,
	orangeGoals: number,
	ballTouches: number,
): number {
	const totalGoals = blueGoals + orangeGoals;
	const competitiveness = Math.abs(blueGoals - orangeGoals);
	const aerial = cars[0]!.aerialTouches + cars[1]!.aerialTouches;
	return (
		totalGoals * 85 +
		competitiveness * 35 +
		cars[0]!.touches * 4 +
		cars[1]!.touches * 4 +
		ballTouches * 0.6 +
		aerial * 22
	);
}

function makeCar(
	scene: Scene,
	team: "blue" | "orange",
	slot: number,
	x: number,
	z: number,
	yaw: number,
): TrainCar {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
	const player = new Player(scene, mesh);
	player.resetKickoffPose(x, 1.4, z, yaw);
	return {
		player,
		team,
		slot,
		touches: 0,
		aerialTouches: 0,
	};
}

function resetKickoff(ball: GameObject, cars: TrainCar[], seed: number): void {
	ball.rapierRigidBody.setTranslation(
		{ x: 0, y: BALL_RADIUS + 0.08, z: 0 },
		true,
	);
	ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
	ball.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
	cars[0]!.player.resetKickoffPose((seed % 3) - 1, 1.4, -22, 0);
	cars[1]!.player.resetKickoffPose(((seed + 1) % 3) - 1, 1.4, 22, Math.PI);
	for (const car of cars) {
		car.player.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		car.player.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
	}
}
