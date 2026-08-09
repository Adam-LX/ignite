/**
 * Audyt grip / powerslide — lateral decay + exit blend.
 *
 *   npm run audit:grip
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import RAPIER from "@dimforge/rapier3d-compat";

import RocketCar from "../src/physics/RocketCar";
import Scene from "../src/Scene";
import { RL_CAR } from "../src/util/rlConstants";
import {
	createTestCar,
	createTestScene,
	FRAME_DT,
	localForwardSpeed,
	MockControlInput,
} from "../tests/physics/harness";

type CaseResult = {
	id: string;
	pass: boolean;
	detail: string;
};

function simulateFrame(
	scene: Scene,
	car: RocketCar,
	input: MockControlInput,
): void {
	car.control(input, FRAME_DT);
	scene.advancePhysics(
		FRAME_DT,
		(dt, substep, substepCount) =>
			car.integrateHover(dt, substep, substepCount),
		(_dt, substep, substepCount) =>
			car.finalizeHoverStep(substep, substepCount),
	);
	car.afterPhysics(FRAME_DT);
}

function settle(scene: Scene, car: RocketCar, input: MockControlInput): void {
	car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
	car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
	car.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
	for (let i = 0; i < 90; i++) simulateFrame(scene, car, input);
}

function lateralSpeed(car: RocketCar): number {
	const side = car.getSideward();
	const v = car.getVelocity();
	return Math.abs(v.x * side.x + v.y * side.y + v.z * side.z);
}

function runCase(
	id: string,
	opts: { shift: boolean; releaseShiftAt?: number },
): {
	id: string;
	halfLife: number;
	latAt05: number;
	latAt15: number;
	fwdKeep: number;
} {
	const scene = createTestScene();
	const car = createTestCar(scene);
	const input = new MockControlInput();
	settle(scene, car, input);

	/** Pęd w bok + lekki gaz (drift nie powinien realignować do nosa). */
	car.rapierRigidBody.setLinvel({ x: 10, y: 0, z: 8 }, true);
	input.setForward(opts.shift ? 0.15 : 0.35);
	input.setShift(opts.shift);

	let halfLife = -1;
	let latAt05 = 0;
	const startLat = lateralSpeed(car);
	const startFwd = Math.abs(localForwardSpeed(car));
	for (let i = 0; i < 90; i++) {
		if (opts.releaseShiftAt != null && i === opts.releaseShiftAt) {
			input.setShift(false);
		}
		simulateFrame(scene, car, input);
		const lat = lateralSpeed(car);
		if (i === 29) latAt05 = lat;
		if (halfLife < 0 && lat <= startLat * 0.5) {
			halfLife = i * FRAME_DT;
		}
	}
	const latAt15 = lateralSpeed(car);
	const fwdKeep = Math.abs(localForwardSpeed(car)) / Math.max(0.1, startFwd);
	return {
		id,
		halfLife: halfLife < 0 ? 99 : halfLife,
		latAt05,
		latAt15,
		fwdKeep,
	};
}

async function main(): Promise<void> {
	await RAPIER.init();
	const outDir = join(process.cwd(), "test-results", "grip-powerslide");
	mkdirSync(outDir, { recursive: true });

	const grip = runCase("grip_no_shift", { shift: false });
	const slide = runCase("powerslide_hold", { shift: true });
	const exit = runCase("powerslide_exit", { shift: true, releaseShiftAt: 18 });

	const checks: CaseResult[] = [
		{
			id: grip.id,
			pass: grip.halfLife < 0.35 && grip.latAt05 < 1.5,
			detail: `halfLife=${grip.halfLife.toFixed(3)}s lat@0.5s=${grip.latAt05.toFixed(2)} (want sticky <0.35s / <1.5)`,
		},
		{
			id: slide.id,
			pass: slide.halfLife > 0.28 && slide.latAt05 > 4.0,
			detail: `halfLife=${slide.halfLife.toFixed(3)}s lat@0.5s=${slide.latAt05.toFixed(2)} (want slide >0.28s / >4.0)`,
		},
		{
			id: exit.id,
			pass: exit.latAt15 < slide.latAt15 * 0.65,
			detail: `lat@1.5s=${exit.latAt15.toFixed(2)} vs slide ${slide.latAt15.toFixed(2)} (exit recovers grip)`,
		},
		{
			id: "constants",
			pass:
				RL_CAR.lateralGrip > RL_CAR.driftGrip * 4 &&
				RL_CAR.gripExitBlendSec > 0.05 &&
				RL_CAR.gripExitBlendSec < 0.35,
			detail: `lateral=${RL_CAR.lateralGrip} drift=${RL_CAR.driftGrip} exit=${RL_CAR.gripExitBlendSec}s`,
		},
	];

	const allPass = checks.every((c) => c.pass);
	const md = [
		"# Grip / Powerslide Audit",
		"",
		`Wynik: **${allPass ? "PASS" : "FAIL"}**`,
		"",
		"| Case | Pass | Detail |",
		"|------|------|--------|",
		...checks.map(
			(c) => `| ${c.id} | ${c.pass ? "✓" : "✗"} | ${c.detail} |`,
		),
		"",
		`fwdKeep grip=${grip.fwdKeep.toFixed(2)} slide=${slide.fwdKeep.toFixed(2)}`,
		"",
	].join("\n");

	writeFileSync(join(outDir, "GRIP.md"), md);
	console.info(md);
	process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
