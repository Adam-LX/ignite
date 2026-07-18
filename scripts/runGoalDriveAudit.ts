/**
 * Audyt jazdy w bramce — ostre kryteria (nie „wjedź i natychmiast wyjedź”).
 *
 * 1) Brak wywrotki w pierwszych 2 m za linią
 * 2) Wjazd + wall-ride na tylną ścianę (y↑)
 * 3) Przejście na sufit kieszeni
 * 4) Wymiary vs RL
 *
 *   npm run audit:goal-drive
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { resetArenaRuntime } from "../src/arena/ArenaRuntime";
import RocketCar from "../src/physics/RocketCar";
import Scene from "../src/Scene";
import { buildArenaPhysics } from "../src/visual/arena";
import { RL_ARENA } from "../src/visual/arenaConstants";

const DT = 1 / 60;
const OUT = "test-results/goal-drive";

const RL_GOAL = {
	widthM: (892.755 * 2) / 100,
	heightM: 642.775 / 100,
	depthM: 880 / 100,
} as const;

class DriveInput {
	fwd = 1;
	boost = true;
	yawVal = 0;

	forward = () => this.fwd;
	yaw = () => this.yawVal;
	roll = () => 0;
	isBoosting = () => this.boost;
	isShiftDown = () => false;
	isJumpHeld = () => false;
	consumeRecover = () => false;
	peekJump = () => false;
	consumeJump = () => false;
	hasFlipDirection = () =>
		Math.abs(this.fwd) > 0.2 || Math.abs(this.yawVal) > 0.2;
}

type Sample = {
	t: number;
	past: number;
	y: number;
	upY: number;
	ny: number;
	onWall: boolean;
	speed: number;
};

type CaseResult = {
	id: string;
	pass: boolean;
	detail: string;
	samples?: Sample[];
};

function step(scene: Scene, car: RocketCar, input: DriveInput): void {
	car.control(input, DT);
	scene.advancePhysics(
		DT,
		(dt, sub, n) => car.integrateHover(dt, sub, n),
		(_dt, sub, n) => car.finalizeHoverStep(sub, n),
	);
	car.afterPhysics(DT);
}

function settle(scene: Scene, car: RocketCar, frames: number): void {
	const idle = new DriveInput();
	idle.fwd = 0;
	idle.boost = false;
	for (let i = 0; i < frames; i++) step(scene, car, idle);
}

function makeCar(scene: Scene): RocketCar {
	return new RocketCar(
		scene,
		new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6)),
	);
}

function sample(car: RocketCar, t: number, zSign: 1 | -1): Sample {
	const p = car.getPosition();
	const n = car.getSurfaceNormal();
	return {
		t,
		past: zSign * p.z - RL_ARENA.HALF_LENGTH,
		y: p.y,
		upY: car.getUpward().y,
		ny: n.y,
		onWall: car.isOnWallOrRamp(),
		speed: car.getVelocity().length(),
	};
}

function dimsCase(): CaseResult {
	const w = RL_ARENA.GOAL_WIDTH;
	const h = RL_ARENA.GOAL_HEIGHT;
	const d = RL_ARENA.GOAL_DEPTH;
	const ok =
		Math.abs(w - RL_GOAL.widthM) < 0.35 &&
		Math.abs(h - RL_GOAL.heightM) < 0.35 &&
		Math.abs(d - RL_GOAL.depthM) < 0.35;
	return {
		id: "dims_vs_rl",
		pass: ok,
		detail: `Ignite ${w.toFixed(2)}×${h.toFixed(2)}×${d.toFixed(2)} vs RL ${RL_GOAL.widthM.toFixed(2)}×${RL_GOAL.heightM.toFixed(2)}×${RL_GOAL.depthM.toFixed(2)}`,
	};
}

/** Kryterium: w past∈[0, 2] min(upY) ≥ 0.75 i nigdy upY < 0.45. */
function caseNoFlipAtLine(
	scene: Scene,
	zSign: 1 | -1,
	laneX: number,
): CaseResult {
	const hl = RL_ARENA.HALF_LENGTH;
	const car = makeCar(scene);
	const yaw = zSign > 0 ? 0 : Math.PI;
	car.resetKickoffPose(laneX, 0.9, zSign * hl - zSign * 12, yaw);
	settle(scene, car, 55);
	const input = new DriveInput();
	car.boostFuel = 1;
	car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: zSign * 18 }, true);

	const samples: Sample[] = [];
	let minUp = 1;
	let flip = false;
	for (let i = 0; i < 160; i++) {
		step(scene, car, input);
		const s = sample(car, i * DT, zSign);
		if (s.past >= -0.5 && s.past <= 2.2) {
			samples.push(s);
			minUp = Math.min(minUp, s.upY);
			if (s.upY < 0.45) flip = true;
		}
		if (s.past > 2.5) break;
	}
	const pass = !flip && minUp >= 0.75 && samples.length >= 5;
	return {
		id: `no_flip_line_${zSign > 0 ? "orange" : "blue"}_x${laneX}`,
		pass,
		detail: `minUp=${minUp.toFixed(2)} flip=${flip} samples=${samples.length}`,
		samples,
	};
}

/** Wjedź w tył bramki ćwiartką — y≥3 i onWall. */
function caseClimbBackWall(scene: Scene, zSign: 1 | -1): CaseResult {
	const hl = RL_ARENA.HALF_LENGTH;
	const depth = RL_ARENA.GOAL_DEPTH;
	const car = makeCar(scene);
	const yaw = zSign > 0 ? 0 : Math.PI;
	/** Start już w płaskiej strefie wlotu, nos w tył. */
	car.resetKickoffPose(0, 0.9, zSign * (hl + 2.2), yaw);
	settle(scene, car, 40);
	const input = new DriveInput();
	car.boostFuel = 1;
	car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: zSign * 20 }, true);

	const samples: Sample[] = [];
	let maxY = 0;
	let wallAtHeight = false;
	for (let i = 0; i < 320; i++) {
		step(scene, car, input);
		const s = sample(car, i * DT, zSign);
		if (i % 3 === 0) samples.push(s);
		maxY = Math.max(maxY, s.y);
		if (s.y >= 3.0 && s.onWall && s.ny < 0.55) wallAtHeight = true;
		/** Za daleko poza kieszeń / spadł. */
		if (s.past > depth + 1) break;
	}
	const pass = wallAtHeight && maxY >= 3.0;
	return {
		id: `climb_back_${zSign > 0 ? "orange" : "blue"}`,
		pass,
		detail: `maxY=${maxY.toFixed(2)} wallAtHeight=${wallAtHeight}`,
		samples,
	};
}

/** Ze ściany tylnej / boku — utrzymaj się blisko sufitu. */
function caseClimbCeiling(scene: Scene, zSign: 1 | -1): CaseResult {
	const hl = RL_ARENA.HALF_LENGTH;
	const gh = RL_ARENA.GOAL_HEIGHT;
	const depth = RL_ARENA.GOAL_DEPTH;
	const car = makeCar(scene);
	const yaw = zSign > 0 ? 0 : Math.PI;
	/** Blisko tylnej ćwiartki, z prędkością w głąb. */
	car.resetKickoffPose(0, 0.9, zSign * (hl + depth - 2.4), yaw);
	settle(scene, car, 35);
	const input = new DriveInput();
	car.boostFuel = 1;
	car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: zSign * 22 }, true);

	const samples: Sample[] = [];
	let maxY = 0;
	let ceilingHold = false;
	for (let i = 0; i < 400; i++) {
		step(scene, car, input);
		const s = sample(car, i * DT, zSign);
		if (i % 4 === 0) samples.push(s);
		maxY = Math.max(maxY, s.y);
		if (s.y >= gh - 1.8 && s.onWall && s.ny < 0.35) ceilingHold = true;
	}
	const pass = ceilingHold && maxY >= gh - 1.8;
	return {
		id: `climb_ceiling_${zSign > 0 ? "orange" : "blue"}`,
		pass,
		detail: `maxY=${maxY.toFixed(2)}/${(gh - 1.8).toFixed(2)} ceilingHold=${ceilingHold}`,
		samples,
	};
}

function toMarkdown(cases: CaseResult[]): string {
	const lines = [
		"# Goal drive audit v2",
		"",
		`Generated: ${new Date().toISOString()}`,
		"",
		"## Kryteria",
		"- `no_flip_line_*`: w past∈[0,2] min(upY)≥0.75, brak upY<0.45",
		"- `climb_back_*`: y≥3 przy onWall (tylna ćwiartka)",
		"- `climb_ceiling_*`: y≥GOAL_HEIGHT−1.8 przy onWall/sufit",
		"",
		"## Cases",
		"",
	];
	for (const c of cases) {
		lines.push(`### ${c.pass ? "PASS" : "FAIL"} — \`${c.id}\``);
		lines.push(c.detail);
		lines.push("");
	}
	const failed = cases.filter((c) => !c.pass);
	lines.push("## Summary");
	lines.push(
		failed.length === 0
			? "All cases passed."
			: `${failed.length} failed: ${failed.map((f) => f.id).join(", ")}`,
	);
	return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
	resetArenaRuntime();
	mkdirSync(OUT, { recursive: true });
	await RAPIER.init();
	const scene = new Scene();
	buildArenaPhysics(scene.rapierWorld);
	scene.rapierWorld.step();

	const cases: CaseResult[] = [dimsCase()];
	for (const zSign of [1, -1] as const) {
		for (const x of [0, 4, 6.5]) {
			cases.push(caseNoFlipAtLine(scene, zSign, x));
		}
		cases.push(caseClimbBackWall(scene, zSign));
		cases.push(caseClimbCeiling(scene, zSign));
	}

	const md = toMarkdown(cases);
	writeFileSync(join(OUT, "GOAL_DRIVE.md"), md);
	writeFileSync(
		join(OUT, "goal-drive.json"),
		JSON.stringify({ cases }, null, 2),
	);
	console.log(md);
	const failed = cases.filter((c) => !c.pass);
	process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
