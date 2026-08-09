/**
 * Headless aerial smoke — metryki bez skillu gracza.
 *
 *   npm run probe:aerial
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { AERIAL_SMOKE_SCENARIOS } from "../src/debug/aerialSmokeScenarios";
import GameObject from "../src/GameObject";
import RocketCar from "../src/physics/RocketCar";
import Scene from "../src/Scene";
import { RL_BALL } from "../src/util/rlConstants";
import { RL_ARENA } from "../src/visual/arenaConstants";
import { buildArenaPhysics } from "../src/visual/arena";

const DT = 1 / 60;
const OUT = "test-results/aerial-smoke";

class Input {
	fwd = 0;
	boost = false;
	yawVal = 0;
	jumpQ = 0;
	jumpHeld = false;

	forward = () => this.fwd;
	yaw = () => this.yawVal;
	roll = () => 0;
	isBoosting = () => this.boost;
	isShiftDown = () => false;
	isJumpHeld = () => this.jumpHeld;
	consumeRecover = () => false;
	peekJump = () => this.jumpQ > 0;
	consumeJump = () => {
		if (this.jumpQ <= 0) return false;
		this.jumpQ--;
		return true;
	};
	hasFlipDirection = () =>
		Math.abs(this.fwd) > 0.2 || Math.abs(this.yawVal) > 0.2;
	queueJump() {
		this.jumpQ = Math.min(3, this.jumpQ + 1);
	}
}

type Verdict = {
	id: string;
	pass: boolean;
	detail: string;
	metrics: Record<string, number>;
};

function step(scene: Scene, car: RocketCar, input: Input): void {
	car.control(input, DT);
	scene.advancePhysics(
		DT,
		(dt, sub, n) => car.integrateHover(dt, sub, n),
		(_dt, sub, n) => car.finalizeHoverStep(sub, n),
	);
	car.afterPhysics(DT);
}

function makeCar(scene: Scene): RocketCar {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
	return new RocketCar(scene, mesh);
}

function makeBall(scene: Scene): GameObject {
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(RL_BALL.radius));
	return new GameObject(scene, mesh, {
		colliderDesc: RAPIER.ColliderDesc.ball(RL_BALL.radius)
			.setRestitution(0)
			.setMass(RL_BALL.mass)
			.setFriction(RL_BALL.groundFriction),
		rigidBodyDesc: RAPIER.RigidBodyDesc.dynamic()
			.setLinearDamping(RL_BALL.airLinearDamp)
			.setAngularDamping(RL_BALL.airAngularDamp)
			.setCcdEnabled(true),
	});
}

async function main(): Promise<void> {
	await RAPIER.init();
	mkdirSync(OUT, { recursive: true });

	const scene = new Scene();
	buildArenaPhysics(scene.rapierWorld);
	const car = makeCar(scene);
	const ball = makeBall(scene);
	const input = new Input();
	const verdicts: Verdict[] = [];

	for (const scenario of AERIAL_SMOKE_SCENARIOS) {
		const pose = scenario.build();
		car.applyDevSpawnPose(pose.car);
		const body = ball.rapierRigidBody;
		body.setTranslation(
			{ x: pose.ball.x, y: pose.ball.y, z: pose.ball.z },
			true,
		);
		const bv = pose.ball.vel ?? { x: 0, y: 0, z: 0 };
		body.setLinvel({ x: bv.x, y: bv.y, z: bv.z }, true);

		input.fwd = 1;
		input.boost = true;
		input.yawVal = 0;
		input.jumpQ = 0;
		car.boostFuel = pose.car.boost ?? 1;

		if ((pose.car.jumpCount ?? 0) === 0 && pose.car.grounded) {
			input.queueJump();
		}

		let minY = 999;
		let maxY = -999;
		let maxSpeed = 0;
		let nanFrames = 0;
		let floorClip = 0;
		let ballTouches = 0;
		let prevDist = Infinity;
		const frames = 180;

		for (let i = 0; i < frames; i++) {
			if (scenario.id === "double_jump_window" && i === 8) {
				input.queueJump();
			}
			if (scenario.id === "fast_aerial_launch" && i === 4) {
				input.queueJump();
			}
			if (scenario.id === "wall_leave_aerial" && i === 6) {
				input.queueJump();
			}
			if (scenario.id === "falling_recovery") {
				input.boost = i < 40;
				input.fwd = 0.2;
			}

			step(scene, car, input);
			ball.syncWithRigidBody();

			const p = car.getPosition();
			const v = car.getVelocity();
			const bt = body.translation();
			if (![p.x, p.y, p.z, v.x, v.y, v.z].every(Number.isFinite)) {
				nanFrames++;
			}
			minY = Math.min(minY, p.y);
			maxY = Math.max(maxY, p.y);
			maxSpeed = Math.max(maxSpeed, v.length());
			if (p.y < -1) floorClip++;

			const dist = Math.hypot(p.x - bt.x, p.y - bt.y, p.z - bt.z);
			if (dist < RL_BALL.radius + 1.1 && prevDist > dist) {
				ballTouches++;
			}
			prevDist = dist;
		}

		const ceiling = RL_ARENA.HEIGHT + 6;
		const pass =
			nanFrames === 0 &&
			floorClip === 0 &&
			minY > -0.5 &&
			maxY < ceiling &&
			maxSpeed < 55;

		verdicts.push({
			id: scenario.id,
			pass,
			detail: `minY=${minY.toFixed(2)} maxY=${maxY.toFixed(2)} maxSpd=${maxSpeed.toFixed(1)} nan=${nanFrames} clip=${floorClip} touches≈${ballTouches}`,
			metrics: { minY, maxY, maxSpeed, nanFrames, floorClip, ballTouches },
		});
	}

	const allPass = verdicts.every((v) => v.pass);
	const report = {
		stamp: new Date().toISOString(),
		allPass,
		verdicts,
	};
	const jsonPath = join(OUT, `aerial-smoke-${Date.now()}.json`);
	writeFileSync(jsonPath, JSON.stringify(report, null, 2));
	writeFileSync(
		join(OUT, "latest.md"),
		[
			`# Aerial smoke`,
			``,
			`allPass: **${allPass}**`,
			``,
			...verdicts.map(
				(v) => `- ${v.pass ? "PASS" : "FAIL"} \`${v.id}\` — ${v.detail}`,
			),
		].join("\n"),
	);

	console.info(`[aerial-smoke] wrote ${jsonPath}`);
	for (const v of verdicts) {
		console.info(`  ${v.pass ? "PASS" : "FAIL"} ${v.id}: ${v.detail}`);
	}
	if (!allPass) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
