/**
 * Headless audit: wall-ride + wjazd/trzymanie na suficie (RL-style).
 *
 *   npm run audit:wall-ceiling
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as THREE from "three";

import RocketCar from "../src/physics/RocketCar";
import Scene from "../src/Scene";
import { RL_ARENA } from "../src/visual/arenaConstants";
import { buildArenaPhysics } from "../src/visual/arena";
import { RAMP_BASE_Y, RAMP_RUN, RAMP_TOP_Y } from "../src/visual/perimeter/constants";
import { RL_CAR } from "../src/util/rlConstants";

const FRAME_DT = 1 / 60;
const OUT_DIR = "test-results/wall-ceiling";

class DriveInput {
	fwd = 1;
	boost = true;
	yawVal = 0;

	forward(): number {
		return this.fwd;
	}
	yaw(): number {
		return this.yawVal;
	}
	roll(): number {
		return 0;
	}
	isBoosting(): boolean {
		return this.boost;
	}
	isShiftDown(): boolean {
		return false;
	}
	isJumpHeld(): boolean {
		return false;
	}
	consumeRecover(): boolean {
		return false;
	}
	peekJump(): boolean {
		return false;
	}
	consumeJump(): boolean {
		return false;
	}
	hasFlipDirection(): boolean {
		return Math.abs(this.fwd) > 0.2 || Math.abs(this.yawVal) > 0.2;
	}
}

type Sample = {
	t: number;
	x: number;
	y: number;
	z: number;
	speed: number;
	onWall: boolean;
	ny: number;
	upY: number;
};

type CaseResult = {
	id: string;
	pass: boolean;
	detail: string;
	samples: Sample[];
};

function step(scene: Scene, car: RocketCar, input: DriveInput): void {
	car.control(input, FRAME_DT);
	scene.advancePhysics(
		FRAME_DT,
		(dt, sub, n) => car.integrateHover(dt, sub, n),
		(_dt, sub, n) => car.finalizeHoverStep(sub, n),
	);
	car.afterPhysics(FRAME_DT);
}

function sample(car: RocketCar, t: number): Sample {
	const p = car.getPosition();
	const n = car.getSurfaceNormal();
	return {
		t,
		x: p.x,
		y: p.y,
		z: p.z,
		speed: car.getVelocity().length(),
		onWall: car.isOnWallOrRamp(),
		ny: n.y,
		upY: car.getUpward().y,
	};
}

function makeCar(scene: Scene): RocketCar {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
	return new RocketCar(scene, mesh);
}

/** Wjazd w boczną bandę z murawy. */
function caseWallEntry(scene: Scene): CaseResult {
	const car = makeCar(scene);
	const idle = new DriveInput();
	idle.fwd = 0;
	idle.boost = false;
	/** Nos w +X (ściana +X): yaw +π/2 → lokalne +Z → world +X. */
	car.resetKickoffPose(RL_ARENA.HALF_WIDTH - 12, 0.9, 0, Math.PI / 2);
	/** Usiądź na zawieszeniu — start w powietrzu wywraca auto przy uderzeniu w rampę. */
	for (let i = 0; i < 90; i++) step(scene, car, idle);

	const input = new DriveInput();
	car.boostFuel = 1;
	car.rapierRigidBody.setLinvel({ x: 20, y: 0, z: 0 }, true);

	const samples: Sample[] = [];
	let hitWall = false;
	let maxY = 0;
	let maxOnWallY = 0;
	let maxSep = 0;

	for (let i = 0; i < 300; i++) {
		step(scene, car, input);
		const s = sample(car, i * FRAME_DT);
		if (i % 6 === 0) samples.push(s);
		maxY = Math.max(maxY, s.y);
		if (s.onWall) {
			hitWall = true;
			maxOnWallY = Math.max(maxOnWallY, s.y);
			const vn = car.getVelocity().dot(car.getSurfaceNormal());
			maxSep = Math.max(maxSep, vn);
		}
	}

	/** Quarter-pipe: wjazd = wysokość na rampie/ścianie > ~0.55·R. */
	const climb = maxOnWallY > RAMP_BASE_Y + Math.min(2.2, RAMP_RUN * 0.55);
	const pass =
		hitWall &&
		climb &&
		maxY < RL_ARENA.HEIGHT + 6 &&
		maxSep < RL_CAR.wallRideSeparationMax + 3;
	return {
		id: "wall_entry_climb",
		pass,
		detail: `hitWall=${hitWall} climb=${climb} maxY=${maxY.toFixed(2)} onWallY=${maxOnWallY.toFixed(2)} maxSep=${maxSep.toFixed(2)}`,
		samples,
	};
}

/**
 * Sonda progu murawa→rampa: brak podbicia (spike Y) i dojście powyżej czubka bandy.
 */
function caseRampEntrySmooth(scene: Scene): CaseResult {
	const car = makeCar(scene);
	const idle = new DriveInput();
	idle.fwd = 0;
	idle.boost = false;
	car.resetKickoffPose(RL_ARENA.HALF_WIDTH - 14, 0.9, 0, Math.PI / 2);
	for (let i = 0; i < 90; i++) step(scene, car, idle);

	const input = new DriveInput();
	input.boost = true;
	car.boostFuel = 1;
	car.rapierRigidBody.setLinvel({ x: 16, y: 0, z: 0 }, true);

	let prevY = car.getPosition().y;
	let maxUpVel = 0;
	let maxYJump = 0;
	let maxY = prevY;
	let reachedWall = false;
	let stuckBelowTop = true;

	for (let i = 0; i < 360; i++) {
		step(scene, car, input);
		const p = car.getPosition();
		const vy = car.getVelocity().y;
		const dy = p.y - prevY;
		/** Spike tylko przy styku murawa→rampa (nie podczas wspinaczki). */
		if (
			p.x > RL_ARENA.HALF_WIDTH - 4 &&
			p.x < RL_ARENA.HALF_WIDTH + RAMP_RUN * 0.55 &&
			p.y < RAMP_BASE_Y + 1.2
		) {
			maxYJump = Math.max(maxYJump, dy);
			maxUpVel = Math.max(maxUpVel, vy);
		}
		maxY = Math.max(maxY, p.y);
		if (car.isOnWallOrRamp() && p.y > RAMP_BASE_Y + RAMP_RUN * 0.85) {
			reachedWall = true;
		}
		if (p.y > RAMP_TOP_Y - 0.35) stuckBelowTop = false;
		prevY = p.y;
	}

	const bumpOk = maxYJump < 0.28 && maxUpVel < 16;
	const pass = bumpOk && reachedWall && !stuckBelowTop;
	return {
		id: "ramp_entry_smooth",
		pass,
		detail: `bumpOk=${bumpOk} maxYJump=${maxYJump.toFixed(3)} maxUpVel=${maxUpVel.toFixed(2)} reachedWall=${reachedWall} stuckBelowTop=${stuckBelowTop} maxY=${maxY.toFixed(2)} (base=${RAMP_BASE_Y.toFixed(2)} top=${RAMP_TOP_Y.toFixed(2)})`,
		samples: [],
	};
}

/** Start na ścianie — jazda w górę. */
function caseWallClimb(scene: Scene): CaseResult {
	const car = makeCar(scene);
	const input = new DriveInput();
	/** Wewnętrzna powierzchnia ściany +X (za rampą). */
	const wallFaceX = RL_ARENA.HALF_WIDTH + RAMP_RUN;
	const x = wallFaceX - (RL_CAR.hitboxHalfY + 0.38);
	car.resetKickoffPose(x, 8, 0, 0);
	// up = −X (w stronę boiska), forward = +Y (wspinaczka).
	const up = new THREE.Vector3(-1, 0, 0);
	const forward = new THREE.Vector3(0, 1, 0);
	const right = new THREE.Vector3().crossVectors(up, forward).normalize();
	forward.crossVectors(right, up).normalize();
	const mat = new THREE.Matrix4().makeBasis(right, up, forward);
	const q = new THREE.Quaternion().setFromRotationMatrix(mat);
	car.rapierRigidBody.setRotation(
		{ x: q.x, y: q.y, z: q.z, w: q.w },
		true,
	);
	car.rapierRigidBody.setLinvel({ x: 0, y: 14, z: 0 }, true);
	car.boostFuel = 1;

	const samples: Sample[] = [];
	let wallFrames = 0;
	let maxY = 8;
	const startY = 8;
	let nearWallFrames = 0;

	for (let i = 0; i < 150; i++) {
		step(scene, car, input);
		const s = sample(car, i * FRAME_DT);
		if (i % 5 === 0) samples.push(s);
		if (s.onWall && s.ny < 0.55) wallFrames++;
		if (Math.abs(s.x - wallFaceX) < 2.5 && s.y > 6) nearWallFrames++;
		maxY = Math.max(maxY, s.y);
	}

	const gained = maxY - startY;
	const pass = (wallFrames >= 25 || nearWallFrames >= 50) && gained > 2.5;
	return {
		id: "wall_climb_hold",
		pass,
		detail: `wallFrames=${wallFrames} nearWall=${nearWallFrames} gainedY=${gained.toFixed(2)} maxY=${maxY.toFixed(2)}`,
		samples,
	};
}

/** Start na suficie przy dużej prędkości — chwilowe utrzymanie. */
function caseCeilingHold(scene: Scene): CaseResult {
	const car = makeCar(scene);
	const input = new DriveInput();
	const y = RL_ARENA.HEIGHT - 1.1;
	car.resetKickoffPose(0, y, 0, 0);
	// Odwrócone — koła w sufit (up ≈ −Y).
	const q = new THREE.Quaternion().setFromEuler(
		new THREE.Euler(Math.PI, 0, 0, "YXZ"),
	);
	car.rapierRigidBody.setRotation(
		{ x: q.x, y: q.y, z: q.z, w: q.w },
		true,
	);
	car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 20 }, true);
	car.boostFuel = 1;

	const samples: Sample[] = [];
	let ceilingFrames = 0;
	let firstDetach: number | null = null;

	for (let i = 0; i < 120; i++) {
		step(scene, car, input);
		const s = sample(car, i * FRAME_DT);
		if (i % 4 === 0) samples.push(s);
		const onCeil = s.onWall && s.ny < -0.25 && s.y > RL_ARENA.HEIGHT - 4;
		if (onCeil) ceilingFrames++;
		else if (ceilingFrames > 0 && firstDetach == null) {
			firstDetach = s.t;
		}
	}

	const holdSec = ceilingFrames * FRAME_DT;
	const pass = holdSec >= 0.35;
	return {
		id: "ceiling_speed_hold",
		pass,
		detail: `holdSec=${holdSec.toFixed(2)} firstDetach=${firstDetach?.toFixed(2) ?? "none"} frames=${ceilingFrames}`,
		samples,
	};
}

/** Transition: ściana wysoko → cove → sufit. */
function caseWallToCeiling(scene: Scene): CaseResult {
	const car = makeCar(scene);
	const input = new DriveInput();
	const wallFaceX = RL_ARENA.HALF_WIDTH + RAMP_RUN;
	const x = wallFaceX - (RL_CAR.hitboxHalfY + 0.38);
	const startY = RL_ARENA.HEIGHT - 5.5;
	car.resetKickoffPose(x, startY, 0, 0);
	const up = new THREE.Vector3(-1, 0, 0);
	const forward = new THREE.Vector3(0, 1, 0);
	const right = new THREE.Vector3().crossVectors(up, forward).normalize();
	forward.crossVectors(right, up).normalize();
	const mat = new THREE.Matrix4().makeBasis(right, up, forward);
	const q = new THREE.Quaternion().setFromRotationMatrix(mat);
	car.rapierRigidBody.setRotation(
		{ x: q.x, y: q.y, z: q.z, w: q.w },
		true,
	);
	car.rapierRigidBody.setLinvel({ x: 0, y: 16, z: 0 }, true);
	car.boostFuel = 1;

	const samples: Sample[] = [];
	let sawCeiling = false;
	let maxY = startY;
	let ceilingFrames = 0;

	for (let i = 0; i < 200; i++) {
		step(scene, car, input);
		const s = sample(car, i * FRAME_DT);
		if (i % 5 === 0) samples.push(s);
		maxY = Math.max(maxY, s.y);
		if (s.ny < -0.2 && s.y > RL_ARENA.HEIGHT - 3.5) {
			sawCeiling = true;
			ceilingFrames++;
		}
	}

	const pass = sawCeiling && ceilingFrames >= 8 && maxY > RL_ARENA.HEIGHT - 2.5;
	return {
		id: "wall_to_ceiling",
		pass,
		detail: `sawCeiling=${sawCeiling} ceilFrames=${ceilingFrames} maxY=${maxY.toFixed(2)} ceilY=${(RL_ARENA.HEIGHT - 0.5).toFixed(2)}`,
		samples,
	};
}

async function main(): Promise<void> {
	const RAPIER = (await import("@dimforge/rapier3d-compat")).default;
	await RAPIER.init();

	mkdirSync(OUT_DIR, { recursive: true });
	const scene = new Scene();
	buildArenaPhysics(scene.rapierWorld);

	const cases = [
		caseRampEntrySmooth(scene),
		caseWallEntry(scene),
		caseWallClimb(scene),
		caseCeilingHold(scene),
		caseWallToCeiling(scene),
	];

	const allPass = cases.every((c) => c.pass);
	const md = [
		"# Wall / Ceiling Audit",
		"",
		`Wynik: **${allPass ? "PASS" : "FAIL"}**`,
		"",
		"| Case | Pass | Detail |",
		"|------|------|--------|",
		...cases.map(
			(c) => `| ${c.id} | ${c.pass ? "✓" : "✗"} | ${c.detail} |`,
		),
		"",
		"Referencja: Rocket League — wall-ride + chwilowe trzymanie na suficie przy prędkości.",
		"",
	].join("\n");

	writeFileSync(join(OUT_DIR, "WALL_CEILING.md"), md);
	writeFileSync(
		join(OUT_DIR, "wall-ceiling.json"),
		JSON.stringify(
			{
				pass: allPass,
				arena: {
					halfW: RL_ARENA.HALF_WIDTH,
					halfL: RL_ARENA.HALF_LENGTH,
					height: RL_ARENA.HEIGHT,
				},
				cases,
			},
			null,
			2,
		),
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
