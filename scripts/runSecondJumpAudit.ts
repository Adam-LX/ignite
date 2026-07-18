/**
 * Audyt drugiego PPM bez kierunku — low vs high speed.
 * Uruchom: npx vite-node scripts/runSecondJumpAudit.ts
 */
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import RocketCar from "../src/physics/RocketCar";
import Scene from "../src/Scene";
import {
	createTestCar,
	createTestScene,
	FRAME_DT,
	MockControlInput,
} from "../tests/physics/harness";

type Sample = {
	frame: number;
	phase: string;
	posY: number;
	vx: number;
	vy: number;
	vz: number;
	speed: number;
	eulerX: number;
	eulerZ: number;
	eulerY: number;
	avx: number;
	avy: number;
	avz: number;
	grounded: boolean;
	wheels: number;
	compressing: number;
	flipping: boolean;
	jumpCount: number;
	forwardIn: number;
	yawIn: number;
};

function eulerFromCar(car: RocketCar): THREE.Euler {
	const rot = car.rapierRigidBody.rotation();
	const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
	return new THREE.Euler().setFromQuaternion(q, "YXZ");
}

function sample(
	frame: number,
	phase: string,
	car: RocketCar,
	input: MockControlInput,
): Sample {
	const vel = car.getVelocity();
	const e = eulerFromCar(car);
	const av = car.rapierRigidBody.angvel();
	return {
		frame,
		phase,
		posY: car.getPosition().y,
		vx: vel.x,
		vy: vel.y,
		vz: vel.z,
		speed: Math.hypot(vel.x, vel.z),
		eulerX: e.x,
		eulerZ: e.z,
		eulerY: e.y,
		avx: av.x,
		avy: av.y,
		avz: av.z,
		grounded: car.isOnGround(),
		wheels: car.getWheelsGroundedCount(),
		compressing: 0,
		flipping: car.isFlipping(),
		jumpCount: 0,
		forwardIn: input.forward(),
		yawIn: input.yaw(),
	};
}

function simulateFrame(
	scene: Scene,
	car: RocketCar,
	input: MockControlInput,
	frameDt: number,
): void {
	car.control(input, frameDt);
	scene.advancePhysics(
		frameDt,
		(fixedDt, substep, substepCount) => {
			car.integrateHover(fixedDt, substep, substepCount);
		},
		(_fixedDt, substep, substepCount) => {
			car.finalizeHoverStep(substep, substepCount);
		},
	);
	car.afterPhysics(frameDt);
}

type ScenarioOpts = {
	initialSpeedZ: number;
	forwardDuringJump1?: number;
	forwardAtJump2?: number;
	framesBeforeJump2?: number;
	holdJump2?: boolean;
};

function runScenario(label: string, opts: ScenarioOpts): {
	label: string;
	samples: Sample[];
	maxPitchDeg: number;
	maxRollDeg: number;
	pitchDeltaAfter2nd: number;
} {
	const scene = createTestScene();
	const car = createTestCar(scene);
	const input = new MockControlInput();

	car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
	car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: opts.initialSpeedZ }, true);

	// Ustabilizuj hover
	for (let i = 0; i < 90; i++) simulateFrame(scene, car, input, FRAME_DT);

	const samples: Sample[] = [];
	let frame = 0;
	const log = (phase: string) => {
		samples.push(sample(frame, phase, car, input));
	};

	log("hover");

	const fwd1 = opts.forwardDuringJump1 ?? 0;
	if (fwd1 !== 0) input.setForward(fwd1);

	// 1. skok
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrame(scene, car, input, FRAME_DT);
	frame++;
	log("jump1");

	input.setJumpHeld(false);
	if (fwd1 !== 0) input.setForward(0);

	const gap = opts.framesBeforeJump2 ?? 14;
	for (let i = 0; i < gap; i++) {
		simulateFrame(scene, car, input, FRAME_DT);
		frame++;
	}
	log("pre-jump2");

	const eulerBefore2 = eulerFromCar(car);

	// 2. skok
	const fwd2 = opts.forwardAtJump2 ?? 0;
	if (fwd2 !== 0) input.setForward(fwd2);
	if (opts.holdJump2) input.setJumpHeld(true);

	input.queueJump();
	simulateFrame(scene, car, input, FRAME_DT);
	frame++;
	log("jump2");

	for (let i = 0; i < 30; i++) {
		simulateFrame(scene, car, input, FRAME_DT);
		frame++;
		if (i === 0 || i === 4 || i === 9 || i === 19 || i === 29) {
			log(`post-jump2+${i + 1}`);
		}
	}

	const eulerAfter = eulerFromCar(car);
	const maxPitchDeg = Math.max(
		...samples.map((s) => Math.abs((s.eulerX * 180) / Math.PI)),
	);
	const maxRollDeg = Math.max(
		...samples.map((s) => Math.abs((s.eulerZ * 180) / Math.PI)),
	);
	const pitchDeltaAfter2nd =
		Math.abs(eulerAfter.x - eulerBefore2.x) * (180 / Math.PI);

	return {
		label,
		samples,
		maxPitchDeg,
		maxRollDeg,
		pitchDeltaAfter2nd,
	};
}

function printReport(result: ReturnType<typeof runScenario>): void {
	console.log(`\n=== ${result.label} ===`);
	console.log(
		`max |pitch|=${result.maxPitchDeg.toFixed(2)}° max |roll|=${result.maxRollDeg.toFixed(2)}° ` +
			`Δpitch po 2nd jump=${result.pitchDeltaAfter2nd.toFixed(2)}°`,
	);
	for (const s of result.samples) {
		console.log(
			`f${String(s.frame).padStart(3)} ${s.phase.padEnd(14)} ` +
				`y=${s.posY.toFixed(2)} spd=${s.speed.toFixed(2)} ` +
				`pitch=${((s.eulerX * 180) / Math.PI).toFixed(1)}° roll=${((s.eulerZ * 180) / Math.PI).toFixed(1)}° ` +
				`av=(${s.avx.toFixed(2)},${s.avy.toFixed(2)},${s.avz.toFixed(2)}) ` +
				`g=${s.grounded ? 1 : 0} wh=${s.wheels} flip=${s.flipping ? 1 : 0}`,
		);
	}
}

async function main(): Promise<void> {
	await RAPIER.init();

	const scenarios: Array<[string, ScenarioOpts]> = [
		["LOW SPEED (0 m/s)", { initialSpeedZ: 0 }],
		["HIGH SPEED (12 m/s)", { initialSpeedZ: 12 }],
		["LOW + W then release before 2nd", { initialSpeedZ: 0, forwardDuringJump1: 1 }],
		["LOW + ghost W=0.15 at 2nd PPM", { initialSpeedZ: 0, forwardAtJump2: 0.15 }],
		["LOW + fast 2nd PPM (5 frames)", { initialSpeedZ: 0, framesBeforeJump2: 5 }],
		["LOW + hold PPM on 2nd", { initialSpeedZ: 0, holdJump2: true }],
	];

	const results = scenarios.map(([label, opts]) => runScenario(label, opts));

	for (const r of results) printReport(r);

	const bad = results.some(
		(r) =>
			r.maxPitchDeg > 8 || r.maxRollDeg > 8 || r.pitchDeltaAfter2nd > 5,
	);
	console.log(
		bad
			? "\n[WARN] Low-speed scenario shows significant orientation drift."
			: "\n[OK] Low-speed orientation within audit thresholds.",
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
