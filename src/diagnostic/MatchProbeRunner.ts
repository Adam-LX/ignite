import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { AIManager } from "../ai/AIManager";
import {
	isBotStableOnWheels,
	isBotUnstable,
} from "../ai/botRecovery";
import { pickNearestBoostPad } from "../ai/botTactics";
import { BotLearning } from "../ai/learning/BotLearning";
import { BoostPadManager } from "../arena/BoostPadManager";
import { buildRlKickoffSpawns } from "../game/rlKickoffSpawns";
import GameObject from "../GameObject";
import Scene from "../Scene";
import Player from "../util/Player";
import { RL_BALL, RL_CAR } from "../util/rlConstants";
import {
	applyCarBallHitsAll,
	snapshotBallKinematics,
	stabilizePlayerPhysics,
	updateBallPhysics,
} from "../util/rlContacts";
import { buildArenaPhysics, detectGoalScored } from "../visual/arena";
import { RL_ARENA } from "../visual/arenaConstants";
import {
	deriveMatchProbeFindings,
	formatFindingsMarkdown,
} from "./matchProbeFindings";
import type {
	MatchProbeAggregate,
	MatchProbeCarMetrics,
	MatchProbeMatchMetrics,
	MatchProbeReport,
	ProbeFsmKey,
	ProbeModeId,
} from "./matchProbeTypes";

const FRAME_DT = 1 / 60;
const BALL_RADIUS = RL_BALL.radius;
const RECOVERY_TIMEOUT_SEC = 3.5;
const NEAR_BALL = 2.6;
const WHIFF_CLOSE = 7.5;
const WHIFF_WINDOW = 0.45;

export type RunMatchProbeOptions = {
	matches?: number;
	seconds?: number;
	mode?: ProbeModeId;
	seed?: number;
	outDir?: string;
	/** Wyłącz zapis plików (testy). */
	writeFiles?: boolean;
};

type ProbeCar = {
	player: Player;
	team: "blue" | "orange";
	slot: number;
	touches: number;
	aerialTouches: number;
	boostSum: number;
	boostSamples: number;
	boostWasteSec: number;
	whiffCount: number;
	padSeeks: number;
	padPickups: number;
	fsmSec: Record<ProbeFsmKey, number>;
	recoveryEpisodes: number;
	recoverySuccesses: number;
	recoveryFailTimeouts: number;
	recoveryTimeSum: number;
	/** Aktywny epizod recovery. */
	recoveryActive: boolean;
	recoveryElapsed: number;
	prevFuel: number;
	whiffArmed: boolean;
	whiffTimer: number;
	lastHitAge: number;
	seekingPad: boolean;
	wallSec: number;
	ceilingSec: number;
	zoneSec: { mid: number; side: number; corner: number; goal: number };
};

function emptyFsm(): Record<ProbeFsmKey, number> {
	return {
		ALIGN_SHOT: 0,
		REPOSITION: 0,
		RECOVERY: 0,
		AERIAL: 0,
	};
}

function makeCar(
	scene: Scene,
	team: "blue" | "orange",
	slot: number,
	x: number,
	z: number,
	yaw: number,
): ProbeCar {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
	const player = new Player(scene, mesh);
	player.resetKickoffPose(x, 1.4, z, yaw);
	player.boostFuel = RL_CAR.boostSpawn;
	return {
		player,
		team,
		slot,
		touches: 0,
		aerialTouches: 0,
		boostSum: 0,
		boostSamples: 0,
		boostWasteSec: 0,
		whiffCount: 0,
		padSeeks: 0,
		padPickups: 0,
		fsmSec: emptyFsm(),
		recoveryEpisodes: 0,
		recoverySuccesses: 0,
		recoveryFailTimeouts: 0,
		recoveryTimeSum: 0,
		recoveryActive: false,
		recoveryElapsed: 0,
		prevFuel: player.getBoostFuel(),
		whiffArmed: false,
		whiffTimer: 0,
		lastHitAge: 99,
		seekingPad: false,
		wallSec: 0,
		ceilingSec: 0,
		zoneSec: { mid: 0, side: 0, corner: 0, goal: 0 },
	};
}

function applyRlKickoff(
	ball: GameObject,
	cars: ProbeCar[],
	mode: ProbeModeId,
	seed = 0,
): { diagonalOk: boolean } {
	ball.rapierRigidBody.setTranslation(
		{ x: 0, y: BALL_RADIUS + 0.08, z: 0 },
		true,
	);
	ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
	ball.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

	const spawns = buildRlKickoffSpawns(mode, 0.65);
	const blue = spawns.find((s) => s.team === "blue")!;
	const orange = spawns.find((s) => s.team === "orange")!;
	const blueCar = cars.find((c) => c.team === "blue")!;
	const orangeCar = cars.find((c) => c.team === "orange")!;

	/** Lekki jitter ze seeda — różne przebiegi probe (deterministyczne per seed). */
	const j = (n: number) => {
		const x = Math.sin(seed * 12.9898 + n) * 43758.5453;
		return x - Math.floor(x) - 0.5;
	};
	const bx = blue.position.x + j(1) * 1.2;
	const bz = blue.position.z + j(2) * 0.8;
	const ox = orange.position.x + j(3) * 1.2;
	const oz = orange.position.z + j(4) * 0.8;

	blueCar.player.resetKickoffPose(bx, blue.position.y, bz, blue.yaw);
	orangeCar.player.resetKickoffPose(ox, orange.position.y, oz, orange.yaw);
	for (const car of cars) {
		car.player.boostFuel = RL_CAR.boostSpawn;
		car.player.boostRegenMul = 1;
		car.player.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		car.player.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		car.prevFuel = RL_CAR.boostSpawn;
	}

	const diagonalOk =
		Math.sign(bx) !== 0 &&
		Math.sign(ox) !== 0 &&
		Math.sign(bx) !== Math.sign(ox);

	return { diagonalOk };
}

function tickWhiff(car: ProbeCar, ballPos: THREE.Vector3, dt: number): void {
	car.lastHitAge += dt;
	const pos = car.player.getPosition();
	const toBall = new THREE.Vector3().copy(ballPos).sub(pos);
	const dist = toBall.length();
	const closeSpeed =
		dist > 0.05
			? -car.player.getVelocity().dot(toBall.normalize())
			: 0;

	if (dist < NEAR_BALL && closeSpeed > WHIFF_CLOSE && car.lastHitAge > 0.2) {
		car.whiffArmed = true;
		car.whiffTimer = 0;
	}
	if (!car.whiffArmed) return;
	car.whiffTimer += dt;
	if (car.lastHitAge < 0.15) {
		car.whiffArmed = false;
		car.whiffTimer = 0;
	} else if (car.whiffTimer >= WHIFF_WINDOW && dist > NEAR_BALL + 1.2) {
		car.whiffCount += 1;
		car.whiffArmed = false;
		car.whiffTimer = 0;
	} else if (car.whiffTimer > WHIFF_WINDOW + 0.6) {
		car.whiffArmed = false;
		car.whiffTimer = 0;
	}
}

function tickBoostWaste(
	car: ProbeCar,
	ballDist: number,
	boosting: boolean,
	dt: number,
): void {
	const speed = car.player.getVelocity().length();
	if (
		boosting &&
		car.player.isOnGround() &&
		speed >= RL_CAR.maxSpeed * 0.9 &&
		ballDist > 22
	) {
		car.boostWasteSec += dt;
	}
}

function tickRecovery(car: ProbeCar, dt: number): void {
	const unstable = isBotUnstable(car.player);
	if (unstable && !car.recoveryActive) {
		car.recoveryActive = true;
		car.recoveryElapsed = 0;
		car.recoveryEpisodes += 1;
	}
	if (!car.recoveryActive) return;
	car.recoveryElapsed += dt;
	if (isBotStableOnWheels(car.player)) {
		car.recoverySuccesses += 1;
		car.recoveryTimeSum += car.recoveryElapsed;
		car.recoveryActive = false;
		car.recoveryElapsed = 0;
	} else if (car.recoveryElapsed >= RECOVERY_TIMEOUT_SEC) {
		car.recoveryFailTimeouts += 1;
		car.recoveryActive = false;
		car.recoveryElapsed = 0;
	}
}

/** Jeden headless mecz Core 1v1 z pełną telemetrią. */
export async function runMatchProbeMatch(
	seconds: number,
	seed: number,
	mode: ProbeModeId = "1v1",
): Promise<MatchProbeMatchMetrics> {
	await RAPIER.init();
	BotLearning.resetForTests();

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

	const cars: ProbeCar[] = [
		makeCar(scene, "blue", 0, 0, -22, 0),
		makeCar(scene, "orange", 1, 0, 22, Math.PI),
	];

	const { diagonalOk } = applyRlKickoff(ball, cars, mode, seed);
	/**
	 * Probe bez padów (produktowo wyłączone).
	 * Pusta lista — boty nie szukają padów; telemetria padSeek=0 jest OK.
	 */
	const pads = new BoostPadManager([]);
	const ai = new AIManager();
	ai.registerBot(0, "blue");
	ai.registerBot(1, "orange");

	let blueGoals = 0;
	let orangeGoals = 0;
	let ballTouches = 0;
	let kickoffFirstContactSec: number | null = null;
	let kickoffBoostSpent: number | null = null;
	let kickoffSegmentStart = 0;
	let segmentHadContact = false;
	let kickoffStartFuel =
		cars[0]!.player.getBoostFuel() + cars[1]!.player.getBoostFuel();
	let maxPassiveRegenDelta = 0;
	const hitImpacts: number[] = [];
	let nearBallOrbitSec = 0;
	let nearMissDeadHits = 0;

	pads.onPickup((event) => {
		const car = cars.find((c) => c.player === event.player);
		if (car) car.padPickups += 1;
	});

	const ballPos = new THREE.Vector3();
	const ballVel = new THREE.Vector3();
	const frames = Math.floor(seconds / FRAME_DT);

	for (let f = 0; f < frames; f++) {
		const t = f * FRAME_DT;
		ballPos.copy(ball.getPosition());
		const bv = ball.rapierRigidBody.linvel();
		ballVel.set(bv.x, bv.y, bv.z);

		const padStates = pads.getPadStates().map((p) => ({
			x: p.x,
			z: p.z,
			big: p.big,
			active: p.active,
		}));

		const peers = cars.map((car) => ({
			slotIndex: car.slot,
			team: car.team,
			position: car.player.getPosition(),
			isHuman: false,
		}));

		const inKickoffWindow =
			!segmentHadContact && t - kickoffSegmentStart < 8;

		const worldCtx = {
			ballPos,
			ballVel,
			kickoffActive: inKickoffWindow,
			kickoffCountdown: false,
			kickoffDriveLocked: false,
			carsFrozen: false,
			isFFA: false,
			teamSize: 1 as const,
			peers,
			boostPads: padStates,
		};

		ai.beginFrame(worldCtx, FRAME_DT);

		for (const car of cars) {
			const drive = ai.think(
				car.slot,
				car.player,
				worldCtx,
				null,
				FRAME_DT,
			);

			const fsm = ai.getBehavior(car.slot)?.getFsmState() ?? "ALIGN_SHOT";
			car.fsmSec[fsm] += FRAME_DT;

			const fuel = car.player.getBoostFuel();
			car.boostSum += fuel;
			car.boostSamples += 1;

			const pos = car.player.getPosition();
			const ballDist = pos.distanceTo(ballPos);
			tickWhiff(car, ballPos, FRAME_DT);
			tickBoostWaste(car, ballDist, drive.boost, FRAME_DT);
			tickRecovery(car, FRAME_DT);

			const n = car.player.getSurfaceNormal();
			if (car.player.isOnWallOrRamp()) {
				if (n.y < -0.25) car.ceilingSec += FRAME_DT;
				else car.wallSec += FRAME_DT;
			}
			{
				const ax = Math.abs(pos.x);
				const az = Math.abs(pos.z);
				const nearGoal = az > RL_ARENA.HALF_LENGTH * 0.72;
				const nearSide = ax > RL_ARENA.HALF_WIDTH * 0.55;
				const nearCorner =
					ax > RL_ARENA.HALF_WIDTH * 0.45 && az > RL_ARENA.HALF_LENGTH * 0.45;
				if (nearCorner) car.zoneSec.corner += FRAME_DT;
				else if (nearGoal) car.zoneSec.goal += FRAME_DT;
				else if (nearSide) car.zoneSec.side += FRAME_DT;
				else car.zoneSec.mid += FRAME_DT;
			}

			if (fuel < 0.32) {
				const pad = pickNearestBoostPad(pos.x, pos.z, padStates, {
					preferBig: fuel < 0.2,
				});
				if (pad && pad.dist < 35) {
					const toPad = Math.hypot(pad.x - pos.x, pad.z - pos.z);
					const vel = car.player.getVelocity();
					const toward =
						toPad > 0.2
							? (vel.x * (pad.x - pos.x) + vel.z * (pad.z - pos.z)) / toPad
							: 0;
					if (toward > 2 && !car.seekingPad) {
						car.seekingPad = true;
						car.padSeeks += 1;
					}
					if (toward < 0.5) car.seekingPad = false;
				} else {
					car.seekingPad = false;
				}
			} else {
				car.seekingPad = false;
			}

			/** Passive regen: fuel↑ bez pickup / bez bycia na padzie. */
			const delta = fuel - car.prevFuel;
			if (delta > 0.002 && !drive.boost) {
				const nearPad = padStates.some(
					(p) => Math.hypot(p.x - pos.x, p.z - pos.z) < 3.5,
				);
				if (!nearPad && delta < 0.1) {
					maxPassiveRegenDelta = Math.max(maxPassiveRegenDelta, delta);
				}
			}
			car.prevFuel = fuel;
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
		if (hit.impact > 0) hitImpacts.push(hit.impact);

		/** Sustained orbit bez hitów = dead approach (nie: każda klatka near ball). */
		{
			let anyNear = false;
			for (const car of cars) {
				const d = car.player.getPosition().distanceTo(ball.getPosition());
				if (d < NEAR_BALL) anyNear = true;
			}
			if (anyNear && hit.impact < 0.35) {
				nearBallOrbitSec += FRAME_DT;
				if (nearBallOrbitSec >= 0.85) {
					nearMissDeadHits += 1;
					nearBallOrbitSec = 0;
				}
			} else {
				nearBallOrbitSec = 0;
			}
		}

		if (hit.impact > 0.5) {
			ballTouches += 1;
			segmentHadContact = true;
			for (const car of cars) {
				car.lastHitAge = 0;
				const d = car.player.getPosition().distanceTo(ball.getPosition());
				if (d < 3.2) car.touches += 1;
				if (d < 3.4 && ball.getPosition().y > 1.35) {
					if (!car.player.isOnGround()) car.aerialTouches += 1;
				}
			}
			if (kickoffFirstContactSec == null) {
				kickoffFirstContactSec = t - kickoffSegmentStart;
				const nowFuel =
					cars[0]!.player.getBoostFuel() + cars[1]!.player.getBoostFuel();
				kickoffBoostSpent = Math.max(0, kickoffStartFuel - nowFuel);
			}
		}

		pads.update(
			FRAME_DT,
			cars.map((c) => c.player),
		);

		updateBallPhysics(ball, BALL_RADIUS, FRAME_DT, scene.rapierWorld);
		for (const car of cars) {
			car.player.afterPhysics(FRAME_DT);
			stabilizePlayerPhysics(car.player);
		}

		const scored = detectGoalScored(ball.getPosition(), BALL_RADIUS);
		if (scored === "blue" || scored === "orange") {
			if (scored === "blue") blueGoals += 1;
			else orangeGoals += 1;
			applyRlKickoff(ball, cars, mode, seed + Math.floor(t * 10));
			kickoffSegmentStart = t + FRAME_DT;
			segmentHadContact = false;
			kickoffStartFuel =
				cars[0]!.player.getBoostFuel() + cars[1]!.player.getBoostFuel();
			pads.reset();
		}
	}

	const carMetrics: MatchProbeCarMetrics[] = cars.map((c) => ({
		slot: c.slot,
		team: c.team,
		touches: c.touches,
		aerialTouches: c.aerialTouches,
		avgBoostFuel: c.boostSamples > 0 ? c.boostSum / c.boostSamples : 0,
		boostSamples: c.boostSamples,
		boostWasteSec: c.boostWasteSec,
		whiffCount: c.whiffCount,
		padSeeks: c.padSeeks,
		padPickups: c.padPickups,
		fsmSec: { ...c.fsmSec },
		recoveryEpisodes: c.recoveryEpisodes,
		recoverySuccesses: c.recoverySuccesses,
		recoveryFailTimeouts: c.recoveryFailTimeouts,
		avgRecoverySec:
			c.recoverySuccesses > 0 ? c.recoveryTimeSum / c.recoverySuccesses : 0,
		wallSec: c.wallSec,
		ceilingSec: c.ceilingSec,
		zoneSec: { ...c.zoneSec },
	}));

	return {
		seed,
		mode,
		seconds,
		blueGoals,
		orangeGoals,
		ballTouches,
		kickoffFirstContactSec,
		kickoffBoostSpent,
		kickoffDiagonalOk: diagonalOk,
		maxPassiveRegenDelta,
		hitImpacts,
		/** Liczba epizodów „orbit bez hitu” ≥0.85 s. */
		nearMissDeadHits,
		cars: carMetrics,
	};
}

export function aggregateMatchProbes(
	matches: MatchProbeMatchMetrics[],
): MatchProbeAggregate {
	const n = matches.length || 1;
	const sum = (fn: (m: MatchProbeMatchMetrics) => number) =>
		matches.reduce((a, m) => a + fn(m), 0);

	const contacts = matches
		.map((m) => m.kickoffFirstContactSec)
		.filter((x): x is number => x != null);
	const over4 = contacts.filter((c) => c > 4).length;
	const diagFails = matches.filter((m) => !m.kickoffDiagonalOk).length;

	let boostFuel = 0;
	let boostCars = 0;
	let padSeeks = 0;
	let padPickups = 0;
	let whiffs = 0;
	let waste = 0;
	let recEp = 0;
	let recFail = 0;
	let dead = 0;
	let wallSec = 0;
	let ceilingSec = 0;

	for (const m of matches) {
		dead += m.nearMissDeadHits;
		for (const c of m.cars) {
			boostFuel += c.avgBoostFuel;
			boostCars += 1;
			padSeeks += c.padSeeks;
			padPickups += c.padPickups;
			whiffs += c.whiffCount;
			waste += c.boostWasteSec;
			recEp += c.recoveryEpisodes;
			recFail += c.recoveryFailTimeouts;
			wallSec += c.wallSec;
			ceilingSec += c.ceilingSec;
		}
	}

	return {
		matchCount: matches.length,
		mode: matches[0]?.mode ?? "1v1",
		secondsPerMatch: matches[0]?.seconds ?? 0,
		avgBlueGoals: sum((m) => m.blueGoals) / n,
		avgOrangeGoals: sum((m) => m.orangeGoals) / n,
		avgBallTouches: sum((m) => m.ballTouches) / n,
		avgKickoffFirstContactSec:
			contacts.length > 0
				? contacts.reduce((a, b) => a + b, 0) / contacts.length
				: null,
		kickoffContactOver4sRate:
			contacts.length > 0 ? over4 / contacts.length : 0,
		kickoffDiagonalFailRate: matches.length > 0 ? diagFails / matches.length : 0,
		avgBoostFuel: boostCars > 0 ? boostFuel / boostCars : 0,
		avgPadSeeks: matches.length > 0 ? padSeeks / matches.length : 0,
		avgPadPickups: matches.length > 0 ? padPickups / matches.length : 0,
		recoveryFailRate: recEp > 0 ? recFail / recEp : 0,
		avgWhiffs: matches.length > 0 ? whiffs / matches.length : 0,
		avgBoostWasteSec: matches.length > 0 ? waste / matches.length : 0,
		nearMissDeadHitRate: matches.length > 0 ? dead / matches.length : 0,
		passiveRegenSuspect: matches.some((m) => m.maxPassiveRegenDelta > 0.01),
		avgWallSec: boostCars > 0 ? wallSec / boostCars : 0,
		avgCeilingSec: boostCars > 0 ? ceilingSec / boostCars : 0,
		matches,
	};
}

export async function runMatchProbe(
	opts: RunMatchProbeOptions = {},
): Promise<MatchProbeReport> {
	const matchesN = opts.matches ?? 5;
	const seconds = opts.seconds ?? 90;
	const mode = opts.mode ?? "1v1";
	const baseSeed = opts.seed ?? 42;
	const writeFiles = opts.writeFiles !== false;
	const outDir = opts.outDir ?? "data/match-probes";

	const results: MatchProbeMatchMetrics[] = [];
	for (let i = 0; i < matchesN; i++) {
		const seed = baseSeed + i * 9973;
		console.info(
			`[match-probe] match ${i + 1}/${matchesN} seed=${seed} ${seconds}s…`,
		);
		results.push(await runMatchProbeMatch(seconds, seed, mode));
	}

	const aggregate = aggregateMatchProbes(results);
	const findings = deriveMatchProbeFindings(aggregate);
	const report: MatchProbeReport = {
		generatedAt: new Date().toISOString(),
		aggregate,
		findings,
	};

	if (writeFiles) {
		mkdirSync(outDir, { recursive: true });
		const stamp = report.generatedAt.replace(/[:.]/g, "-");
		const jsonPath = join(outDir, `probe-${stamp}.json`);
		const mdPath = join(outDir, "FINDINGS.md");
		writeFileSync(jsonPath, JSON.stringify(report, null, 2));
		writeFileSync(mdPath, formatFindingsMarkdown(findings, aggregate));
		console.info(`[match-probe] wrote ${jsonPath}`);
		console.info(`[match-probe] wrote ${mdPath}`);
		console.info(`[match-probe] findings: ${findings.length}`);
	}

	return report;
}
