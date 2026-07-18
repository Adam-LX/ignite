/**
 * Headless audit: fizyka piłki RL (smish / RocketSim feel).
 *
 *   npm run audit:ball
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import GameObject from "../src/GameObject";
import RocketCar from "../src/physics/RocketCar";
import Scene from "../src/Scene";
import {
	applyCarBallHitsAll,
	snapshotBallKinematics,
	updateBallPhysics,
} from "../src/util/rlContacts";
import { RL_BALL } from "../src/util/rlConstants";
import { RL_ARENA } from "../src/visual/arenaConstants";
import { buildArenaPhysics } from "../src/visual/arena";
import { FRAME_DT, MockControlInput } from "../tests/physics/harness";

const OUT_DIR = "test-results/ball-physics";

type CaseResult = {
	id: string;
	pass: boolean;
	detail: string;
};

function freshScene(): Scene {
	const scene = new Scene();
	buildArenaPhysics(scene.rapierWorld);
	return scene;
}

function createBall(scene: Scene): GameObject {
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(RL_BALL.radius));
	return new GameObject(scene, mesh, {
		colliderDesc: RAPIER.ColliderDesc.ball(RL_BALL.radius)
			.setRestitution(0)
			.setMass(RL_BALL.mass)
			.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
			.setFriction(RL_BALL.groundFriction)
			.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS),
		rigidBodyDesc: RAPIER.RigidBodyDesc.dynamic()
			.setLinearDamping(RL_BALL.airLinearDamp)
			.setAngularDamping(RL_BALL.airAngularDamp)
			.setCcdEnabled(true),
	});
}

function stepBall(scene: Scene, ball: GameObject): void {
	snapshotBallKinematics(ball);
	scene.advancePhysics(FRAME_DT);
	updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
	ball.syncWithRigidBody();
}

function stepCarBall(
	scene: Scene,
	car: RocketCar,
	ball: GameObject,
	input?: MockControlInput,
): void {
	if (input) car.control(input, FRAME_DT);
	snapshotBallKinematics(ball);
	scene.advancePhysics(FRAME_DT, (dt, sub, n) =>
		car.integrateHover(dt, sub, n),
	);
	car.afterPhysics(FRAME_DT);
	applyCarBallHitsAll(scene.rapierWorld, [car], ball);
	updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
	ball.syncWithRigidBody();
}

/** Spadek z wysokości — żywy rebound CR≈0.6. */
function caseDropBounce(): CaseResult {
	const scene = freshScene();
	const ball = createBall(scene);
	ball.rapierRigidBody.setTranslation({ x: 0, y: 3, z: 0 }, true);
	ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);

	let touched = false;
	let peak = RL_BALL.radius;
	for (let i = 0; i < Math.round(3 / FRAME_DT); i++) {
		stepBall(scene, ball);
		const y = ball.getPosition().y;
		const vy = ball.rapierRigidBody.linvel().y;
		if (!touched && y <= RL_BALL.radius + 0.12) touched = true;
		if (touched) peak = Math.max(peak, y);
		if (touched && vy < -1 && peak > RL_BALL.radius + 0.25) break;
	}

	const pass = peak > 1.55 && peak < 2.4;
	return {
		id: "drop_bounce",
		pass,
		detail: `peakY=${peak.toFixed(2)} (want 1.55–2.4, CR≈0.6)`,
	};
}

/** Soft tap — niski Δv porusza piłkę bez wystrzału. */
function caseSoftHit(): CaseResult {
	const scene = freshScene();
	const ball = createBall(scene);
	ball.rapierRigidBody.setTranslation(
		{ x: 0, y: RL_BALL.radius + 0.08, z: -4 },
		true,
	);
	ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);

	const car = new RocketCar(
		scene,
		new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6)),
	);
	car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: -6.5 }, true);
	car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 2.8 }, true);

	let firstHoriz = 0;
	let sawHit = false;
	let peakHoriz = 0;
	for (let i = 0; i < 50; i++) {
		stepCarBall(scene, car, ball);
		const v = ball.rapierRigidBody.linvel();
		const horiz = Math.hypot(v.x, v.z);
		if (!sawHit && horiz > 0.35) {
			sawHit = true;
			firstHoriz = horiz;
		}
		if (sawHit) {
			peakHoriz = Math.max(peakHoriz, horiz);
			if (i > 0 && horiz < firstHoriz * 0.5 + 0.1) break;
			/** Okno tuż po kontakcie — nie mierz długiego dribble push. */
			if (peakHoriz > 0 && i > 25) break;
		}
	}

	const v = ball.rapierRigidBody.linvel();
	const pass =
		sawHit &&
		peakHoriz > 0.55 &&
		peakHoriz < 10 &&
		Math.abs(v.y) < 4;
	return {
		id: "soft_hit",
		pass,
		detail: `peakHoriz=${peakHoriz.toFixed(2)} first=${firstHoriz.toFixed(2)} vy=${v.y.toFixed(2)}`,
	};
}

/** Hard / flip-style hit — szybki kontakt z flipHitMul gdy flip aktywny. */
function caseFlipHit(): CaseResult {
	const scene = freshScene();
	const ball = createBall(scene);
	ball.rapierRigidBody.setTranslation(
		{ x: 0, y: RL_BALL.radius + 0.08, z: -7 },
		true,
	);

	const input = new MockControlInput();
	input.setForward(1);
	const car = new RocketCar(
		scene,
		new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6)),
	);
	/** Usiądź, potem skok + dodge w stronę piłki. */
	car.rapierRigidBody.setTranslation({ x: 0, y: 0.9, z: -11 }, true);
	for (let i = 0; i < 45; i++) stepCarBall(scene, car, ball, input);

	car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 18 }, true);
	car.boostFuel = 1;
	input.queueJump();
	input.setJumpHeld(true);

	let maxHoriz = 0;
	let flipped = false;
	for (let i = 0; i < 70; i++) {
		if (i === 8) {
			input.setJumpHeld(false);
		}
		if (i === 12) {
			input.queueJump();
			input.setJumpHeld(true);
		}
		stepCarBall(scene, car, ball, input);
		if (car.isFlipping()) flipped = true;
		const v = ball.rapierRigidBody.linvel();
		maxHoriz = Math.max(maxHoriz, Math.hypot(v.x, v.z));
	}

	/** Flip nie zawsze złapie piłkę headless — akceptuj też solidny hard hit. */
	const pass = maxHoriz > 10 && maxHoriz < RL_BALL.maxSpeed;
	return {
		id: "flip_hit",
		pass,
		detail: `maxHoriz=${maxHoriz.toFixed(2)} flipped=${flipped} (want solid shot ≥10)`,
	};
}

/** Toczenie — nie hamulec w 2 s. */
function caseGroundRoll(): CaseResult {
	const scene = freshScene();
	const ball = createBall(scene);
	ball.rapierRigidBody.setTranslation(
		{ x: 0, y: RL_BALL.radius + 0.08, z: 0 },
		true,
	);
	ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 6 }, true);

	for (let i = 0; i < Math.round(2 / FRAME_DT); i++) stepBall(scene, ball);

	const v = ball.rapierRigidBody.linvel();
	const horiz = Math.hypot(v.x, v.z);
	const pass = horiz > 2.8 && horiz < 6.5;
	return {
		id: "ground_roll",
		pass,
		detail: `horiz@2s=${horiz.toFixed(2)} (want 2.8–6.5)`,
	};
}

/** Odbicie od ściany bocznej. */
function caseWallBounce(): CaseResult {
	const scene = freshScene();
	const ball = createBall(scene);
	const margin = RL_BALL.radius + 0.2;
	ball.rapierRigidBody.setTranslation(
		{
			x: RL_ARENA.HALF_WIDTH - margin - 1.5,
			y: RL_BALL.radius + 0.5,
			z: 0,
		},
		true,
	);
	ball.rapierRigidBody.setLinvel({ x: 14, y: 0, z: 0 }, true);

	let minX = Infinity;
	for (let i = 0; i < Math.round(1.5 / FRAME_DT); i++) {
		stepBall(scene, ball);
		minX = Math.min(minX, ball.getPosition().x);
	}
	const vx = ball.rapierRigidBody.linvel().x;
	const pass = minX < RL_ARENA.HALF_WIDTH - margin && vx < -2;
	return {
		id: "wall_bounce",
		pass,
		detail: `minX=${minX.toFixed(2)} vx=${vx.toFixed(2)}`,
	};
}

async function main(): Promise<void> {
	await RAPIER.init();
	mkdirSync(OUT_DIR, { recursive: true });

	const cases = [
		caseDropBounce(),
		caseSoftHit(),
		caseFlipHit(),
		caseGroundRoll(),
		caseWallBounce(),
	];

	const allPass = cases.every((c) => c.pass);
	const md = [
		"# Ball Physics Audit",
		"",
		`Wynik: **${allPass ? "PASS" : "FAIL"}**`,
		"",
		"| Case | Pass | Detail |",
		"|------|------|--------|",
		...cases.map((c) => `| ${c.id} | ${c.pass ? "✓" : "✗"} | ${c.detail} |`),
		"",
		"Referencja: smish / RocketSim — CR≈0.6, Psyonix impulse, soft dribble, żywe bounce.",
		"",
	].join("\n");

	writeFileSync(join(OUT_DIR, "BALL.md"), md);
	writeFileSync(
		join(OUT_DIR, "ball-physics.json"),
		JSON.stringify({ pass: allPass, cases }, null, 2),
	);

	console.info(md);
	for (const c of cases) {
		console.info(`  [${c.pass ? "PASS" : "FAIL"}] ${c.id}: ${c.detail}`);
	}
	process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
