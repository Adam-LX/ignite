/**
 * Live-feel probe: wjazd / wall / jump / zjazd — konkretne metryki, nie „pass na wyczucie”.
 *
 *   vite-node scripts/probeWallRideFeel.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as THREE from "three";

import RocketCar from "../src/physics/RocketCar";
import Scene from "../src/Scene";
import { RL_ARENA } from "../src/visual/arenaConstants";
import { buildArenaPhysics } from "../src/visual/arena";
import {
	RAMP_BASE_Y,
	RAMP_RUN,
	RAMP_TOP_Y,
} from "../src/visual/perimeter/constants";

const DT = 1 / 60;
const OUT = "test-results/wall-feel";

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
	hasFlipDirection = () => Math.abs(this.fwd) > 0.2 || Math.abs(this.yawVal) > 0.2;
	queueJump() {
		this.jumpQ = Math.min(3, this.jumpQ + 1);
	}
}

type Row = {
	t: number;
	phase: string;
	x: number;
	y: number;
	speed: number;
	vn: number;
	ny: number;
	upDotN: number;
	onWall: boolean;
	wheels: number;
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

function row(car: RocketCar, t: number, phase: string): Row {
	const p = car.getPosition();
	const n = car.getSurfaceNormal();
	const v = car.getVelocity();
	const up = car.getUpward();
	return {
		t,
		phase,
		x: p.x,
		y: p.y,
		speed: v.length(),
		vn: v.dot(n),
		ny: n.y,
		upDotN: up.dot(n),
		onWall: car.isOnWallOrRamp(),
		wheels: car.getWheelsGroundedCount(),
	};
}

function settle(scene: Scene, car: RocketCar, input: Input, frames: number): void {
	input.fwd = 0;
	input.boost = false;
	for (let i = 0; i < frames; i++) step(scene, car, input);
}

function makeCar(scene: Scene): RocketCar {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
	return new RocketCar(scene, mesh);
}

type Verdict = { id: string; pass: boolean; detail: string; metrics: Record<string, number> };

async function main(): Promise<void> {
	const RAPIER = (await import("@dimforge/rapier3d-compat")).default;
	await RAPIER.init();
	mkdirSync(OUT, { recursive: true });

	const scene = new Scene();
	buildArenaPhysics(scene.rapierWorld);
	const car = makeCar(scene);
	const input = new Input();
	const log: Row[] = [];
	const verdicts: Verdict[] = [];

	const wallFaceX = RL_ARENA.HALF_WIDTH + RAMP_RUN;
	const ribbonX = RL_ARENA.HALF_WIDTH;

	// ── 1) Wjazd z murawy ──────────────────────────────────────────
	car.resetKickoffPose(ribbonX - 14, 0.9, 0, Math.PI / 2);
	settle(scene, car, input, 90);
	input.fwd = 1;
	input.boost = true;
	car.boostFuel = 1;
	car.rapierRigidBody.setLinvel({ x: 18, y: 0, z: 0 }, true);

	let maxYJump = 0;
	let prevY = car.getPosition().y;
	let firstWallY = -1;
	let maxY = 0;
	let entrySep = 0;
	for (let i = 0; i < 240; i++) {
		step(scene, car, input);
		const r = row(car, i * DT, "entry");
		if (i % 3 === 0) log.push(r);
		const dy = r.y - prevY;
		if (r.x > ribbonX - 3 && r.y < RAMP_BASE_Y + 1.4) {
			maxYJump = Math.max(maxYJump, dy);
		}
		if (r.onWall && firstWallY < 0) firstWallY = r.y;
		if (r.onWall) entrySep = Math.max(entrySep, r.vn);
		maxY = Math.max(maxY, r.y);
		prevY = r.y;
	}

	verdicts.push({
		id: "entry_smooth",
		pass: maxYJump < 0.28 && firstWallY > 0 && maxY > RAMP_TOP_Y + 1,
		detail: `maxYJump=${maxYJump.toFixed(3)} firstWallY=${firstWallY.toFixed(2)} maxY=${maxY.toFixed(2)} entrySep=${entrySep.toFixed(2)}`,
		metrics: { maxYJump, firstWallY, maxY, entrySep },
	});

	// ── 2) Jazda po ścianie w górę, potem luz ───────────────────────
	// Ustaw auto na ścianie ręcznie (stabilny punkt startu)
	const wallX = wallFaceX - (0.18 + 0.38);
	car.resetKickoffPose(wallX, 8, 0, 0);
	{
		const up = new THREE.Vector3(-1, 0, 0);
		const forward = new THREE.Vector3(0, 1, 0);
		const right = new THREE.Vector3().crossVectors(up, forward).normalize();
		forward.crossVectors(right, up).normalize();
		const mat = new THREE.Matrix4().makeBasis(right, up, forward);
		const q = new THREE.Quaternion().setFromRotationMatrix(mat);
		car.rapierRigidBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 10, z: 0 }, true);
	}
	input.fwd = 1;
	input.boost = true;
	car.boostFuel = 1;
	for (let i = 0; i < 20; i++) step(scene, car, input);

	let climbMaxY = car.getPosition().y;
	let wallFrames = 0;
	let avgSep = 0;
	let sepN = 0;
	for (let i = 0; i < 90; i++) {
		input.fwd = 1;
		input.boost = true;
		step(scene, car, input);
		const r = row(car, i * DT, "climb");
		if (i % 2 === 0) log.push(r);
		climbMaxY = Math.max(climbMaxY, r.y);
		if (r.onWall && r.ny < 0.55) {
			wallFrames++;
			avgSep += Math.abs(r.vn);
			sepN++;
		}
	}
	avgSep = sepN > 0 ? avgSep / sepN : 99;

	verdicts.push({
		id: "wall_climb_hold",
		pass: wallFrames >= 60 && climbMaxY > 12,
		detail: `wallFrames=${wallFrames}/90 climbMaxY=${climbMaxY.toFixed(2)} avg|vn|=${avgSep.toFixed(3)}`,
		metrics: { wallFrames, climbMaxY, avgSep },
	});

	// ── 3) JUMP na ścianie ─────────────────────────────────────────
	car.resetKickoffPose(wallX, 10, 0, 0);
	{
		const up = new THREE.Vector3(-1, 0, 0);
		const forward = new THREE.Vector3(0, 1, 0);
		const right = new THREE.Vector3().crossVectors(up, forward).normalize();
		forward.crossVectors(right, up).normalize();
		const mat = new THREE.Matrix4().makeBasis(right, up, forward);
		const q = new THREE.Quaternion().setFromRotationMatrix(mat);
		car.rapierRigidBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 4, z: 0 }, true);
	}
	input.fwd = 0.35;
	input.boost = false;
	for (let i = 0; i < 45; i++) step(scene, car, input); // usiądź na ścianie

	const beforeJump = row(car, 0, "prejump");
	const nBefore = car.getSurfaceNormal().clone();
	const posBefore = car.getPosition().clone();
	input.queueJump();
	input.jumpHeld = true;

	let maxSepAfterJump = 0;
	let minUpDotN = 1;
	let leftWall = false;
	let stillGlued = true;
	let yDelta = 0;
	for (let i = 0; i < 45; i++) {
		step(scene, car, input);
		if (i === 8) input.jumpHeld = false;
		const r = row(car, i * DT, "jump");
		log.push(r);
		const sep = car.getPosition().clone().sub(posBefore).dot(nBefore);
		maxSepAfterJump = Math.max(maxSepAfterJump, sep);
		minUpDotN = Math.min(minUpDotN, r.upDotN);
		if (!r.onWall) leftWall = true;
		if (sep > 0.45) stillGlued = false;
		yDelta = Math.max(yDelta, Math.abs(r.y - beforeJump.y));
	}

	verdicts.push({
		id: "wall_jump_detach",
		pass: maxSepAfterJump > 0.55 && !stillGlued,
		detail: `maxSep=${maxSepAfterJump.toFixed(3)} leftWall=${leftWall} glued=${stillGlued} preOnWall=${beforeJump.onWall} wheels=${beforeJump.wheels} upDotNmin=${minUpDotN.toFixed(2)}`,
		metrics: {
			maxSepAfterJump,
			leftWall: leftWall ? 1 : 0,
			glued: stillGlued ? 1 : 0,
			preOnWall: beforeJump.onWall ? 1 : 0,
			wheels: beforeJump.wheels,
		},
	});

	// Drugi jump tuż po (czy cooldown nie blokuje)
	car.resetKickoffPose(wallX, 9, 0, 0);
	{
		const up = new THREE.Vector3(-1, 0, 0);
		const forward = new THREE.Vector3(0, 1, 0);
		const right = new THREE.Vector3().crossVectors(up, forward).normalize();
		forward.crossVectors(right, up).normalize();
		const mat = new THREE.Matrix4().makeBasis(right, up, forward);
		const q = new THREE.Quaternion().setFromRotationMatrix(mat);
		car.rapierRigidBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 2, z: 0 }, true);
	}
	input.fwd = 0.2;
	input.boost = false;
	input.jumpHeld = false;
	for (let i = 0; i < 40; i++) step(scene, car, input);
	input.queueJump();
	step(scene, car, input);
	const sep1 = (() => {
		const n = car.getSurfaceNormal();
		const p0 = car.getPosition().clone();
		for (let i = 0; i < 12; i++) step(scene, car, input);
		return car.getPosition().clone().sub(p0).dot(n);
	})();
	// settle back
	for (let i = 0; i < 50; i++) step(scene, car, input);
	input.queueJump();
	const sep2 = (() => {
		const n = car.getSurfaceNormal();
		const p0 = car.getPosition().clone();
		for (let i = 0; i < 12; i++) step(scene, car, input);
		return car.getPosition().clone().sub(p0).dot(n);
	})();

	verdicts.push({
		id: "wall_jump_repeat",
		pass: sep1 > 0.4 && sep2 > 0.35,
		detail: `sep1=${sep1.toFixed(3)} sep2=${sep2.toFixed(3)} (drugi skok po ~0.8s)`,
		metrics: { sep1, sep2 },
	});

	// ── 4) Zjazd w dół ściany (bez boost, lekki gaz wstecz / zero) ──
	car.resetKickoffPose(wallX, 18, 0, 0);
	{
		const up = new THREE.Vector3(-1, 0, 0);
		const forward = new THREE.Vector3(0, -1, 0); // nos w dół
		const right = new THREE.Vector3().crossVectors(up, forward).normalize();
		forward.crossVectors(right, up).normalize();
		const mat = new THREE.Matrix4().makeBasis(right, up, forward);
		const q = new THREE.Quaternion().setFromRotationMatrix(mat);
		car.rapierRigidBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: -6, z: 0 }, true);
	}
	input.fwd = 0.6;
	input.boost = false;
	let descentY0 = car.getPosition().y;
	let descentMinY = descentY0;
	let descentStuck = 0;
	let lastY = descentY0;
	let maxDescentJerk = 0;
	for (let i = 0; i < 180; i++) {
		step(scene, car, input);
		const r = row(car, i * DT, "descent");
		if (i % 3 === 0) log.push(r);
		descentMinY = Math.min(descentMinY, r.y);
		const jerk = Math.abs(r.y - lastY);
		if (r.y < RAMP_TOP_Y + 4) maxDescentJerk = Math.max(maxDescentJerk, jerk);
		if (Math.abs(r.y - lastY) < 0.01 && r.speed < 1.5 && r.y > RAMP_TOP_Y + 2) {
			descentStuck++;
		}
		lastY = r.y;
	}
	const descended = descentY0 - descentMinY;

	verdicts.push({
		id: "wall_descent",
		pass: descended > 8 && descentStuck < 40 && descentMinY < RAMP_TOP_Y + 6,
		detail: `descended=${descended.toFixed(2)} minY=${descentMinY.toFixed(2)} stuckFrames=${descentStuck} maxJerk=${maxDescentJerk.toFixed(3)}`,
		metrics: { descended, descentMinY, descentStuck, maxDescentJerk },
	});

	// ── 5) Zjazd banda → murawa (z czubka rampy w dół) ──────────────
	car.resetKickoffPose(ribbonX + RAMP_RUN * 0.55, RAMP_BASE_Y + RAMP_RUN * 0.55, 0, -Math.PI / 2);
	// Orient roughly along ramp downhill toward field
	{
		const n = new THREE.Vector3(-1, 0.5, 0).normalize(); // approx mid-ramp normal
		const forward = new THREE.Vector3(-1, -0.8, 0).normalize();
		const right = new THREE.Vector3().crossVectors(n, forward).normalize();
		forward.crossVectors(right, n).normalize();
		const mat = new THREE.Matrix4().makeBasis(right, n, forward);
		const q = new THREE.Quaternion().setFromRotationMatrix(mat);
		car.rapierRigidBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
		car.rapierRigidBody.setLinvel({ x: -8, y: -4, z: 0 }, true);
	}
	input.fwd = 0.4;
	input.boost = false;
	let exitMaxJerk = 0;
	let reachedGrass = false;
	let prevYe = car.getPosition().y;
	for (let i = 0; i < 150; i++) {
		step(scene, car, input);
		const r = row(car, i * DT, "exit");
		if (i % 3 === 0) log.push(r);
		const dy = Math.abs(r.y - prevYe);
		if (r.x < ribbonX + 2) exitMaxJerk = Math.max(exitMaxJerk, dy);
		if (r.y < RAMP_BASE_Y + 0.8 && r.x < ribbonX - 1 && r.ny > 0.85) {
			reachedGrass = true;
		}
		prevYe = r.y;
	}

	verdicts.push({
		id: "ramp_exit_to_grass",
		pass: reachedGrass && exitMaxJerk < 0.35,
		detail: `reachedGrass=${reachedGrass} exitMaxJerk=${exitMaxJerk.toFixed(3)}`,
		metrics: { reachedGrass: reachedGrass ? 1 : 0, exitMaxJerk },
	});

	const allPass = verdicts.every((v) => v.pass);
	const md = [
		"# Wall Ride Feel Probe",
		"",
		`Wynik: **${allPass ? "PASS" : "FAIL"}**`,
		"",
		"| Case | Pass | Detail |",
		"|------|------|--------|",
		...verdicts.map(
			(v) => `| ${v.id} | ${v.pass ? "✓" : "✗"} | ${v.detail} |`,
		),
		"",
		"## Interpretacja",
		"- `wall_jump_detach`: skok musi odsunąć auto od ściany (sep > 0.55 m), nie kleić z powrotem.",
		"- `wall_descent`: zjazd w dół bez zawieszenia w połowie ściany.",
		"- `entry/exit`: bez progów (jerk) na styku murawa↔banda.",
		"",
	].join("\n");

	writeFileSync(join(OUT, "WALL_FEEL.md"), md);
	writeFileSync(
		join(OUT, "wall-feel.json"),
		JSON.stringify({ pass: allPass, verdicts, log: log.slice(0, 400) }, null, 2),
	);

	console.log(md);
	for (const v of verdicts) {
		console.log(`  [${v.pass ? "PASS" : "FAIL"}] ${v.id}: ${v.detail}`);
	}
	process.exitCode = allPass ? 0 : 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
