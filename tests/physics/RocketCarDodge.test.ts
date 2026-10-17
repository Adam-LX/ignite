import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
import { RL_CAR } from "../../src/util/rlConstants";
import {
	createTestCar,
	createTestScene,
	localPitchRate,
	localRollRate,
	localYawRate,
	MockControlInput,
	simulateFrames,
} from "./harness";

vi.mock("../../src/debug/config", () => ({
	HOVER_SAFE_MODE: false,
	HOVER_DEBUG_RAYS: false,
	HOVER_FORCE_MAX: 50_000,
	HOVER_TELEMETRY_EVERY_STEPS: 0,
	DEBUG_AUTOPILOT: false,
	AUTOPILOT_DURATION_SEC: 20,
}));

/** Skok z ziemi + frontflip po oknie jump hold. */
function jumpThenFlip(
	scene: Scene,
	car: RocketCar,
	input: MockControlInput,
): void {
	input.setForward(1);
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
	input.setJumpHeld(false);
	/** Min. dodgeWindowAge — puść stick opcjonalnie (RL: trzymane W też flipuje). */
	input.setForward(0);
	/**
	 * jumpHoldMax 0.2 s + min. dodgeWindowAge 0.06 s ≈ 16 klatek @ 60 Hz.
	 * Za długo → lądowanie przed 2. skokiem.
	 */
	simulateFrames(scene, car, input, 16);
	input.setForward(1);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
}

/** Skok + drugi skok z trzymanym kierunkiem (bez odświeżania sticka). */
function jumpThenSecond(
	scene: Scene,
	car: RocketCar,
	input: MockControlInput,
	dir: { forward?: number; yaw?: number },
	opts?: { releaseDirDuringGap?: boolean; gapFrames?: number },
): void {
	const fwd = dir.forward ?? 0;
	const yaw = dir.yaw ?? 0;
	const gap = opts?.gapFrames ?? 16;
	if (fwd !== 0) input.setForward(fwd);
	if (yaw !== 0) input.setYaw(yaw);
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
	input.setJumpHeld(false);
	if (opts?.releaseDirDuringGap) {
		input.setForward(0);
		input.setYaw(0);
	}
	simulateFrames(scene, car, input, gap);
	if (fwd !== 0) input.setForward(fwd);
	if (yaw !== 0) input.setYaw(yaw);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
}

describe("RocketCar — dodge / flip (RL)", () => {
	let scene: Scene;
	let car: RocketCar;
	let input: MockControlInput;

	beforeEach(() => {
		scene = createTestScene();
		car = createTestCar(scene);
		input = new MockControlInput();
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		simulateFrames(scene, car, input, 90);
		expect(car.isOnGround()).toBe(true);
	});

	it("1×PPM + W nigdy nie odpala flipa (tylko air pitch)", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 20);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		for (let i = 0; i < 40; i++) {
			simulateFrames(scene, car, input, 1);
			expect(car.isFlipping()).toBe(false);
		}
		expect(car.getForward().y).toBeLessThan(-0.05);
	});

	it("1×PPM + trzymane W z ziemi daje air pitch (stójka)", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 20);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		simulateFrames(scene, car, input, 25);
		expect(car.isOnGround()).toBe(false);
		expect(car.isFlipping()).toBe(false);
		expect(Math.abs(localPitchRate(car))).toBeGreaterThan(0.35);
		expect(car.getForward().y).toBeLessThan(-0.08);
	});

	it("podwójny edge PPM w jednej klatce + W = skok, nie frontflip", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 20);
		input.setJumpHeld(true);
		input.queueJump();
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		simulateFrames(scene, car, input, 12);
		expect(car.isOnGround()).toBe(false);
		expect(car.isFlipping()).toBe(false);
		expect(input.peekJump()).toBe(false);
	});

	it("trzymany PPM + W to air pitch, nie frontflip", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 20);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setForward(1);
		simulateFrames(scene, car, input, 22);
		expect(car.isFlipping()).toBe(false);
		expect(Math.abs(localPitchRate(car))).toBeGreaterThan(0.3);
		expect(car.getUpward().y).toBeGreaterThan(0.15);
	});

	it("bounce PPM w następnej klatce przy trzymanym jump + W ≠ frontflip", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 20);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.queueJump();
		simulateFrames(scene, car, input, 20);
		expect(car.isFlipping()).toBe(false);
		expect(car.isOnGround()).toBe(false);
	});

	it("klip 00-33: KBM jazda W + PPM + bounce po puszczeniu ≠ frontflip", () => {
		input.setKbmDodgeFilter(true);
		input.setForward(1);
		simulateFrames(scene, car, input, 60);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		simulateFrames(scene, car, input, 9);
		input.setJumpHeld(false);
		input.queueJump();
		simulateFrames(scene, car, input, 20);
		expect(car.isFlipping()).toBe(false);
		/** Air pitch 1×PPM+W może mocno przechylić — byle nie flip. */
		expect(car.getUpward().y).toBeGreaterThan(-0.55);
	});

	it("trzymane W przez oba skoki = frontflip (RL dodge, nie double jump)", () => {
		jumpThenSecond(scene, car, input, { forward: 1 });
		expect(car.isFlipping()).toBe(true);
	});

	it("po flipDuration flipActive kończy się — W to znów air pitch (nie sticky spin)", () => {
		jumpThenSecond(scene, car, input, { forward: 1 });
		expect(car.isFlipping()).toBe(true);
		/** 0.65 s @ 60 Hz ≈ 39 klatek + bufor (w powietrzu, nie przy murawie). */
		car.rapierRigidBody.setTranslation({ x: 0, y: 4.5, z: 0 }, true);
		simulateFrames(scene, car, input, 42);
		expect(car.isFlipping()).toBe(false);
		/** Dokańcz pitch lock / residual. */
		for (let i = 0; i < 90; i++) {
			simulateFrames(scene, car, input, 1);
			if (!car.isPostFlipStabilizing() && !car.isFlipping()) break;
		}
		car.rapierRigidBody.setTranslation({ x: 0, y: 5, z: 0 }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		car.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		input.setForward(1);
		input.setYaw(0);
		simulateFrames(scene, car, input, 20);
		expect(car.isOnGround()).toBe(false);
		expect(Math.abs(localPitchRate(car))).toBeGreaterThan(0.35);
	});

	it("świeży tap W + 2. PPM = frontflip", () => {
		jumpThenFlip(scene, car, input);
		expect(car.isFlipping()).toBe(true);
	});

	it("boost w trakcie flipa dodaje prędkość wzdłuż nosa (nie tylko poziomo)", () => {
		input.setForward(-1);
		simulateFrames(scene, car, input, 25);
		jumpThenSecond(scene, car, input, { forward: -1 });
		expect(car.isFlipping()).toBe(true);

		input.setForward(0);
		input.setBoosting(true);
		car.boostFuel = 1;

		let maxAlongNose = -Infinity;
		for (let i = 0; i < 20; i++) {
			simulateFrames(scene, car, input, 1);
			const v = car.getVelocity();
			const nose = car.getForward();
			maxAlongNose = Math.max(maxAlongNose, v.dot(nose));
		}
		expect(maxAlongNose).toBeGreaterThan(3);
		expect(car.boostFuel).toBeLessThan(1);
	});

	it("sam boost (LMB) w backflipie podnosi vy — jak klip 18-03", () => {
		input.setForward(-1);
		simulateFrames(scene, car, input, 25);
		jumpThenSecond(scene, car, input, { forward: -1 });
		expect(car.isFlipping()).toBe(true);

		input.setForward(0);
		input.setBoosting(true);
		car.boostFuel = 1;
		const vy0 = car.getVelocity().y;

		for (let i = 0; i < 18; i++) {
			simulateFrames(scene, car, input, 1);
		}
		expect(car.getVelocity().y).toBeGreaterThan(vy0 + 1.5);
		expect(car.boostFuel).toBeLessThan(1);
	});

	it("po lądowaniu po flipie kamera wraca na ground (isAirborneForCamera)", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 25);
		jumpThenSecond(scene, car, input, { forward: 1 });
		input.setForward(1);
		for (let i = 0; i < 100; i++) {
			simulateFrames(scene, car, input, 1);
			if (car.isOnGround() && !car.isFlipping()) break;
		}
		expect(car.isOnGround()).toBe(true);
		expect(car.isFlipping()).toBe(false);
		expect(car.isAirborneForCamera()).toBe(false);
	});

	it("frontflip dodaje ~500 uu/s (~5 m/s) poziomo", () => {
		jumpThenFlip(scene, car, input);
		const vel = car.getVelocity();
		const horiz = Math.hypot(vel.x, vel.z);
		expect(car.isFlipping()).toBe(true);
		expect(horiz).toBeGreaterThan(4.2);
		expect(horiz).toBeLessThan(8);
	});

	it("frontflip nie kasuje natychmiast prędkości w górę (pierwsze 0.15 s)", () => {
		jumpThenFlip(scene, car, input);
		expect(car.getVelocity().y).toBeGreaterThan(0.5);
	});

	it("flip cancel (S podczas frontflip) redukuje pitch rate", () => {
		jumpThenFlip(scene, car, input);
		simulateFrames(scene, car, input, 4);
		const rateBefore = Math.abs(localPitchRate(car));
		input.setForward(-1);
		simulateFrames(scene, car, input, 12);
		const rateAfter = Math.abs(localPitchRate(car));
		expect(rateBefore).toBeGreaterThan(0.5);
		expect(rateAfter).toBeLessThan(rateBefore * 0.85);
	});

	it("klip 17-04-27: po cancelu frontflipa brak pitch-lock — S odzyskuje nos", () => {
		jumpThenSecond(scene, car, input, { forward: 1 }, { gapFrames: 10 });
		expect(car.isFlipping()).toBe(true);
		input.setForward(1);
		/** Dojedź do nose-down. */
		for (let i = 0; i < 28; i++) {
			simulateFrames(scene, car, input, 1);
			if (car.getForward().y < -0.55) break;
		}
		expect(car.getForward().y).toBeLessThan(-0.35);

		/** Cancel (S) — wcześniej pitch-lock softlockował przy murawie. */
		input.setForward(-1);
		for (let i = 0; i < 50; i++) {
			simulateFrames(scene, car, input, 1);
			if (!car.isFlipping()) break;
		}
		expect(car.isFlipping()).toBe(false);
		expect(car.isPostFlipStabilizing()).toBe(false);

		const fy0 = car.getForward().y;
		for (let i = 0; i < 35; i++) {
			simulateFrames(scene, car, input, 1);
		}
		expect(car.getForward().y).toBeGreaterThan(fy0 + 0.12);
	});

	it("klip 17-04-27: nos w trawie + S + 2.PPM = backflip (nie ghost-block)", () => {
		/** Nose-down tuż nad murawą po 1. skoku — jak dig z W (+pitch = nos w dół). */
		car.applyDevSpawnPose({
			x: 0,
			y: 1.35,
			z: 0,
			yawY: 0,
			pitch: 1.2,
			jumpCount: 1,
			grounded: false,
			vel: { x: 0, y: 1.5, z: 6 },
		});
		expect(car.getForward().y).toBeLessThan(-0.5);
		/** Min. dodgeWindowAge 0.05 s — bez air pitch (trzymaj postawę). */
		input.setForward(0);
		simulateFrames(scene, car, input, 5);
		expect(car.isFlipping()).toBe(false);

		input.setForward(-1);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);
	});

	it("W trzymane podczas frontflip przechodzi przez nose-down", () => {
		jumpThenFlip(scene, car, input);
		expect(car.isFlipping()).toBe(true);

		let minPitch = Infinity;
		let maxPitch = -Infinity;
		for (let i = 0; i < 40; i++) {
			simulateFrames(scene, car, input, 1);
			const rot = car.rapierRigidBody.rotation();
			const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
			const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
			minPitch = Math.min(minPitch, e.x);
			maxPitch = Math.max(maxPitch, e.x);
		}
		expect(maxPitch).toBeGreaterThan(0.8);
		expect(minPitch).toBeLessThan(-0.35);
	});

	it("air roll (Q/E) działa podczas diagonal flipa", () => {
		const runFlip = (withRoll: boolean) => {
			scene = createTestScene();
			car = createTestCar(scene);
			input = new MockControlInput();
			car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
			car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
			simulateFrames(scene, car, input, 90);
			input.setForward(1);
			input.setYaw(1);
			input.setJumpHeld(true);
			input.queueJump();
			simulateFrames(scene, car, input, 1);
			input.setJumpHeld(false);
			input.setForward(0);
			input.setYaw(0);
			simulateFrames(scene, car, input, 20);
			input.setForward(1);
			input.setYaw(1);
			if (withRoll) input.setRoll(1);
			input.queueJump();
			simulateFrames(scene, car, input, 1);
			expect(car.isFlipping()).toBe(true);
			simulateFrames(scene, car, input, 10);
			return {
				up: car.getUpward().clone(),
				roll: localRollRate(car),
			};
		};

		const base = runFlip(false);
		const rolled = runFlip(true);
		expect(rolled.up.distanceTo(base.up)).toBeGreaterThan(0.12);
		expect(Math.abs(rolled.roll - base.roll)).toBeGreaterThan(0.25);
	});

	it("pełny air roll ma stały damp (RL) — po puszczeniu Q szybko ginie spin", () => {
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 25);
		input.setRoll(1);
		simulateFrames(scene, car, input, 45);
		const held = Math.abs(localRollRate(car));
		expect(held).toBeGreaterThan(1.8);
		expect(held).toBeLessThanOrEqual(RL_CAR.airMaxAngVel + 0.05);

		input.setRoll(0);
		simulateFrames(scene, car, input, 25);
		expect(Math.abs(localRollRate(car))).toBeLessThan(held * 0.45);
	});

	it("PPM+Q przy murawie: pełna beczka bez turtle-snap (uy nie skacze −1→+1)", () => {
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setRoll(1);

		let uprightSnaps = 0;
		let prevUy = car.getUpward().y;
		let minAirRoll = Infinity;
		let rollAccum = 0;
		for (let i = 0; i < 90; i++) {
			simulateFrames(scene, car, input, 1);
			const uy = car.getUpward().y;
			const r = Math.abs(localRollRate(car));
			if (!car.isOnGround()) {
				minAirRoll = Math.min(minAirRoll, r);
				rollAccum += r * (1 / 60);
			}
			if (prevUy < -0.55 && uy > 0.7) uprightSnaps++;
			prevUy = uy;
		}
		expect(uprightSnaps).toBe(0);
		expect(minAirRoll).toBeGreaterThan(RL_CAR.airMaxAngVel * 0.85);
		expect(rollAccum).toBeGreaterThan(Math.PI * 1.5);
	});

	it("2. PPM po air pitch W: spin bez dipu (od razu ≥70% capu)", () => {
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setForward(1);
		simulateFrames(scene, car, input, 18);
		expect(Math.abs(localPitchRate(car))).toBeGreaterThan(
			RL_CAR.airMaxAngVel * 0.9,
		);

		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);
		expect(Math.abs(localPitchRate(car))).toBeGreaterThan(
			RL_CAR.flipMaxAngVel * 0.68,
		);
		simulateFrames(scene, car, input, 3);
		expect(Math.abs(localPitchRate(car))).toBeGreaterThan(
			RL_CAR.flipMaxAngVel * 0.95,
		);
	});

	it("Shift + A/D w powietrzu = beczka (air roll), nie yaw", () => {
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 20);
		expect(car.isOnGround()).toBe(false);

		input.setShift(true);
		input.setYaw(1);
		input.setRoll(0);
		simulateFrames(scene, car, input, 10);
		expect(Math.abs(localRollRate(car))).toBeGreaterThan(0.4);
		expect(Math.abs(localYawRate(car))).toBeLessThan(0.35);
	});

	it("backflip (S) obraca w przeciwną stronę niż frontflip i daje impuls w tył", () => {
		// Frontflip referencyjny
		jumpThenFlip(scene, car, input);
		simulateFrames(scene, car, input, 3);
		const frontPitchRate = localPitchRate(car);
		expect(Math.abs(frontPitchRate)).toBeGreaterThan(0.5);

		// Reset i backflip — S może być trzymane (bez fresh).
		scene = createTestScene();
		car = createTestCar(scene);
		input = new MockControlInput();
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		simulateFrames(scene, car, input, 90);
		expect(car.isOnGround()).toBe(true);

		input.setForward(-1);
		simulateFrames(scene, car, input, 30);
		jumpThenSecond(scene, car, input, { forward: -1 });
		simulateFrames(scene, car, input, 3);

		expect(car.isFlipping()).toBe(true);
		const backPitchRate = localPitchRate(car);
		expect(Math.sign(backPitchRate)).toBe(-Math.sign(frontPitchRate));
	});

	it("trzymane S przez oba skoki = backflip (podwójny dodge KBM)", () => {
		/** Najpierw S na ziemi — freshAge duży → słabszy air pitch (nie staje na nosie). */
		input.setForward(-1);
		simulateFrames(scene, car, input, 30);
		jumpThenSecond(scene, car, input, { forward: -1 });
		expect(car.isFlipping()).toBe(true);
		const vel = car.getVelocity();
		expect(Math.hypot(vel.x, vel.z)).toBeGreaterThan(3.5);
	});

	it("trzymane W przez oba skoki = frontflip (jak RL / jazda+dodge)", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 30);
		jumpThenSecond(scene, car, input, { forward: 1 });
		expect(car.isFlipping()).toBe(true);
		const vel = car.getVelocity();
		expect(Math.hypot(vel.x, vel.z)).toBeGreaterThan(3.5);
	});

	it("klip 13-02: frontflip + hold W nie ląduje żółwiem", () => {
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 4 }, true);
		simulateFrames(scene, car, input, 30);
		input.setForward(1);
		simulateFrames(scene, car, input, 60);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		/** ~376 ms jak na klipie */
		simulateFrames(scene, car, input, 23);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);

		/**
		 * Mierzymy chwilę po końcu flipa blisko murawy — nie kolejne pętle W.
		 */
		let groundedTurtle = false;
		let upNearTurf = 1;
		let nearTurf = false;
		for (let i = 0; i < 120; i++) {
			simulateFrames(scene, car, input, 1);
			if (car.isFlipping()) continue;
			const y = car.getPosition().y;
			const up = car.getUpward().y;
			if (y < 1.35) {
				nearTurf = true;
				upNearTurf = Math.min(upNearTurf, up);
				if (car.isOnGround() && up < -0.15) groundedTurtle = true;
			}
			if (nearTurf && i > 50) break;
		}
		expect(groundedTurtle).toBe(false);
		expect(nearTurf).toBe(true);
		expect(upNearTurf).toBeGreaterThan(0.2);
	});

	it("trzymane A przez oba skoki = sideflip", () => {
		input.setYaw(1);
		simulateFrames(scene, car, input, 30);
		jumpThenSecond(scene, car, input, { yaw: 1 });
		expect(car.isFlipping()).toBe(true);
	});

	it("pierwszy PPM = skok z ziemi, potem świeże W + PPM = frontflip", () => {
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(false);
		simulateFrames(scene, car, input, 20);
		input.setForward(1);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);
		const vel = car.getVelocity();
		expect(Math.hypot(vel.x, vel.z)).toBeGreaterThan(4);
	});

	it("pierwszy PPM = skok, drugi PPM bez kierunku = kopa w górę", () => {
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		simulateFrames(scene, car, input, 20);
		const vyBefore = car.getVelocity().y;
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(false);
		expect(car.getVelocity().y).toBeGreaterThan(vyBefore + 2);
	});

	it("bez WASD drugi skok to double jump w górę, nie flip", () => {
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 20);
		const vyBefore = car.getVelocity().y;
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(false);
		expect(car.getVelocity().y).toBeGreaterThan(vyBefore + 2);
	});

	it("po puszczeniu W przed drugim PPM nie robi frontflipa (trajektoria prosta)", () => {
		input.setForward(1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);

		// Gracz puszcza kierunek przed drugim skokiem.
		input.setJumpHeld(false);
		input.setForward(0);
		simulateFrames(scene, car, input, 20);

		const vzBefore = car.getVelocity().z;
		const vyBefore = car.getVelocity().y;
		input.queueJump();
		simulateFrames(scene, car, input, 1);

		expect(car.isFlipping()).toBe(false);
		expect(car.getVelocity().y).toBeGreaterThan(vyBefore + 2);
		// Bez dodge nie powinno dojść do dużego poziomego "szarpnięcia" toru.
		expect(Math.abs(car.getVelocity().z - vzBefore)).toBeLessThan(1.2);
		const av = car.rapierRigidBody.angvel();
		expect(Math.abs(av.x)).toBeLessThan(0.2);
		expect(Math.abs(av.z)).toBeLessThan(0.2);
	});

	it("diagnoza: drugi PPM bez kierunku nie powinien narastać pitch/roll w kolejnych klatkach", () => {
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 20);
		input.queueJump();
		simulateFrames(scene, car, input, 1);

		let maxPitchAbs = 0;
		let maxRollAbs = 0;
		for (let i = 0; i < 20; i++) {
			simulateFrames(scene, car, input, 1);
			const av = car.rapierRigidBody.angvel();
			maxPitchAbs = Math.max(maxPitchAbs, Math.abs(av.x));
			maxRollAbs = Math.max(maxRollAbs, Math.abs(av.z));
		}

		expect(maxPitchAbs).toBeLessThan(0.25);
		expect(maxRollAbs).toBeLessThan(0.25);
	});

	it("ghost input W=0.15 przy 2nd PPM nie przechyla auta (poniżej dodge deadzone)", () => {
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 20);

		input.setForward(0.15);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(false);

		let maxPitchDeg = 0;
		for (let i = 0; i < 25; i++) {
			simulateFrames(scene, car, input, 1);
			const rot = car.rapierRigidBody.rotation();
			const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
			const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
			maxPitchDeg = Math.max(maxPitchDeg, Math.abs(e.x));
		}
		expect(maxPitchDeg).toBeLessThan(0.35);
	});

	it("W w 1. skoku + neutralny 2nd PPM prostuje pitch/roll", () => {
		input.setForward(1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setForward(0);
		simulateFrames(scene, car, input, 16);

		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(false);

		const rot = car.rapierRigidBody.rotation();
		const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
		const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
		expect(Math.abs(e.x)).toBeLessThan(0.12);
		expect(Math.abs(e.z)).toBeLessThan(0.12);
	});

	it("W trzymane przez 1. skok + świeży tap W = frontflip bez bocznej prędkości", () => {
		input.setForward(1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setForward(0);
		simulateFrames(scene, car, input, 20);

		input.setForward(1);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);

		let maxAbsVx = 0;
		for (let i = 0; i < 20; i++) {
			simulateFrames(scene, car, input, 1);
			maxAbsVx = Math.max(maxAbsVx, Math.abs(car.getVelocity().x));
		}
		expect(maxAbsVx).toBeLessThan(0.2);
	});

	it("świeże W + ghost yaw 0.15 przy frontflip nie dodaje bocznej prędkości", () => {
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 20);

		input.setForward(1);
		input.setYaw(0.15);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);

		let maxAbsVx = 0;
		for (let i = 0; i < 20; i++) {
			simulateFrames(scene, car, input, 1);
			maxAbsVx = Math.max(maxAbsVx, Math.abs(car.getVelocity().x));
		}
		expect(maxAbsVx).toBeLessThan(0.2);
	});

	it("po zakończeniu flipa residual ω dokręca (RL), nie sztuczny Euler upright", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 30);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 16);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);

		for (let i = 0; i < 90; i++) {
			simulateFrames(scene, car, input, 1);
			if (!car.isFlipping()) break;
		}
		expect(car.isFlipping()).toBe(false);
		/** Residual + pitch lock dokańcza obrót po torque window. */
		for (let i = 0; i < 60; i++) {
			simulateFrames(scene, car, input, 1);
		}
		expect(car.getUpward().y).toBeGreaterThan(0.35);
	});

	it("frontflip ląduje w tę samą stronę (~360°, nie half-flip 180°)", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 40);
		const fwd0 = car.getForward().clone();
		fwd0.y = 0;
		fwd0.normalize();

		jumpThenSecond(scene, car, input, { forward: 1 });
		expect(car.isFlipping()).toBe(true);
		input.setForward(1);

		for (let i = 0; i < 120; i++) {
			simulateFrames(scene, car, input, 1);
		}
		const fwd1 = car.getForward().clone();
		fwd1.y = 0;
		if (fwd1.lengthSq() > 1e-6) fwd1.normalize();
		expect(car.getUpward().y).toBeGreaterThan(0.45);
		expect(fwd1.dot(fwd0)).toBeGreaterThan(0.55);
	});

	it("niski frontflip domyka ~360° mimo dotknięcia murawy w trakcie obrotu (klip 17-14)", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 25);
		const fwd0 = car.getForward().clone();
		fwd0.y = 0;
		fwd0.normalize();

		jumpThenSecond(scene, car, input, { forward: 1 }, { gapFrames: 8 });
		expect(car.isFlipping()).toBe(true);
		input.setForward(1);

		let flipEnded = false;
		for (let i = 0; i < 100; i++) {
			simulateFrames(scene, car, input, 1);
			if (!car.isFlipping()) {
				/** Po torque — puść W, mierzymy domknięcie flipa, nie kolejną pętlę air pitch. */
				if (!flipEnded) {
					flipEnded = true;
					input.setForward(0);
				}
			}
		}

		const fwd1 = car.getForward().clone();
		fwd1.y = 0;
		if (fwd1.lengthSq() > 1e-6) fwd1.normalize();
		expect(car.getUpward().y).toBeGreaterThan(0.4);
		expect(fwd1.dot(fwd0)).toBeGreaterThan(0.5);
	});

	it("frontflip (W) bez roll — czysta oś pitch (klip 04:26 skew)", () => {
		input.setForward(1);
		simulateFrames(scene, car, input, 30);
		jumpThenSecond(scene, car, input, { forward: 1 });
		expect(car.isFlipping()).toBe(true);

		input.setForward(1);
		input.setYaw(0);
		let maxAbsRoll = 0;
		let minAbsPitch = Infinity;
		for (let i = 0; i < 20; i++) {
			simulateFrames(scene, car, input, 1);
			maxAbsRoll = Math.max(maxAbsRoll, Math.abs(localRollRate(car)));
			minAbsPitch = Math.min(minAbsPitch, Math.abs(localPitchRate(car)));
		}
		expect(minAbsPitch).toBeGreaterThan(2.0);
		expect(maxAbsRoll).toBeLessThan(1.2);
	});

	it("sideflip (A) bez pitch — czysta oś roll", () => {
		jumpThenSecond(scene, car, input, { yaw: 1 });
		expect(car.isFlipping()).toBe(true);

		input.setYaw(1);
		input.setForward(0);
		let maxAbsPitch = 0;
		let minAbsRoll = Infinity;
		for (let i = 0; i < 20; i++) {
			simulateFrames(scene, car, input, 1);
			maxAbsPitch = Math.max(maxAbsPitch, Math.abs(localPitchRate(car)));
			minAbsRoll = Math.min(minAbsRoll, Math.abs(localRollRate(car)));
		}
		expect(minAbsRoll).toBeGreaterThan(2.0);
		expect(maxAbsPitch).toBeLessThan(1.2);
	});

	it("po lekkim rollu na ziemi przed dodge — flip nadal w poziomie (nie corkscrew)", () => {
		input.setYaw(1);
		simulateFrames(scene, car, input, 20);
		input.setYaw(0);
		input.setForward(1);
		simulateFrames(scene, car, input, 10);
		jumpThenSecond(scene, car, input, { forward: 1 });
		expect(car.isFlipping()).toBe(true);

		input.setForward(1);
		input.setYaw(0);
		let maxAbsRoll = 0;
		for (let i = 0; i < 24; i++) {
			simulateFrames(scene, car, input, 1);
			maxAbsRoll = Math.max(maxAbsRoll, Math.abs(localRollRate(car)));
		}
		expect(maxAbsRoll).toBeLessThan(1.4);
		expect(Math.abs(localPitchRate(car))).toBeGreaterThan(1.5);
	});

	it("backflip z trzymanym S nie kasuje spinu w trakcie torque", () => {
		input.setForward(-1);
		simulateFrames(scene, car, input, 30);
		jumpThenSecond(scene, car, input, { forward: -1 });
		expect(car.isFlipping()).toBe(true);

		input.setForward(-1);
		simulateFrames(scene, car, input, 12);
		expect(Math.abs(localPitchRate(car))).toBeGreaterThan(2);
	});

	it("żółw na ziemi nie jest stableDrive — wstaje (signed upY)", () => {
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.2, z: 0 }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		car.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		car.rapierRigidBody.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
		simulateFrames(scene, car, input, 2);
		expect(car.getUpward().y).toBeLessThan(-0.5);

		input.setForward(-1);
		for (let i = 0; i < 45; i++) {
			simulateFrames(scene, car, input, 1);
		}
		expect(car.getUpward().y).toBeGreaterThan(0.4);
	});

	it("frontflip kontynuuje pitch z air control (bez flatten / restartu animacji)", () => {
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);

		/** Krótki air pitch — potem świeży tap W pod dodge (nie lądować). */
		input.setForward(1);
		simulateFrames(scene, car, input, 10);
		input.setForward(0);
		simulateFrames(scene, car, input, 6);

		const rotBefore = car.rapierRigidBody.rotation();
		const eBefore = new THREE.Euler().setFromQuaternion(
			new THREE.Quaternion(rotBefore.x, rotBefore.y, rotBefore.z, rotBefore.w),
			"YXZ",
		);
		expect(Math.abs(eBefore.x)).toBeGreaterThan(0.015);

		input.setForward(1);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);

		const rotAfter = car.rapierRigidBody.rotation();
		const eAfter = new THREE.Euler().setFromQuaternion(
			new THREE.Quaternion(rotAfter.x, rotAfter.y, rotAfter.z, rotAfter.w),
			"YXZ",
		);
		expect(Math.abs(eAfter.x)).toBeGreaterThan(0.01);
		expect(Math.abs(eAfter.x)).toBeGreaterThan(Math.abs(eBefore.x) * 0.4);
	});

	it("wolny 2×PPM+W po air pitch >90° nie odwraca kierunku flipa", () => {
		/** Nos już za pionem — jak po wolnym air pitch przed 2. PPM. */
		car.applyDevSpawnPose({
			x: 0,
			y: 3.6,
			z: 0,
			yawY: 0,
			pitch: 1.25,
			jumpCount: 1,
			grounded: false,
			vel: { x: 0, y: 0.4, z: 6 },
		});
		expect(car.getForward().y).toBeLessThan(-0.85);

		input.setForward(1);
		simulateFrames(scene, car, input, 4);
		const pitchBefore = localPitchRate(car);
		expect(pitchBefore).toBeGreaterThan(0.25);

		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);

		input.setForward(1);
		simulateFrames(scene, car, input, 10);
		const pitchDuringFlip = localPitchRate(car);
		/** Ten sam znak co air pitch W (nos w dół) — nie reverse z odwróconego yaw. */
		expect(pitchDuringFlip).toBeGreaterThan(1.5);
		expect(Math.sign(pitchDuringFlip)).toBe(Math.sign(pitchBefore));
	});

	it("softlock na kancie (~45° roll) odkleja się na 4 koła", () => {
		const lean = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0.15, 0, 0.85, "YXZ"),
		);
		car.applyDevSpawnPose({
			x: 0,
			y: 0.55,
			z: 0,
			yawY: 0,
			pitch: 0.15,
			roll: 0.85,
			jumpCount: 0,
			grounded: false,
			vel: { x: 0, y: 0, z: 0 },
			angVel: { x: 0, y: 0, z: 0 },
		});
		car.rapierRigidBody.setRotation(
			{ x: lean.x, y: lean.y, z: lean.z, w: lean.w },
			true,
		);
		expect(car.getUpward().y).toBeLessThan(0.75);
		expect(car.getUpward().y).toBeGreaterThan(0.35);

		simulateFrames(scene, car, input, 45);
		expect(car.getUpward().y).toBeGreaterThan(0.75);
	});

	it("PPM na dachu daje mocny recovery (unflip)", () => {
		/**
		 * Lekko nad murawą — przy y=0.35 tarcie kontaktu w 1 klatce zjada ω
		 * (wcześniej test „przechodził” przez bug kumulacji sił w substepach).
		 */
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.1, z: 0 }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		car.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		car.rapierRigidBody.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
		simulateFrames(scene, car, input, 2);

		expect(car.getUpward().y).toBeLessThan(-0.5);

		const upBefore = car.getUpward().y;
		input.queueJump();
		car.control(input, 1 / 60);
		const avKick = car.rapierRigidBody.angvel();
		expect(Math.hypot(avKick.x, avKick.y, avKick.z)).toBeGreaterThan(4);
		expect(car.getVelocity().y).toBeGreaterThan(1.5);

		scene.advancePhysics(
			1 / 60,
			(fixedDt, substep, substepCount) => {
				car.integrateHover(fixedDt, substep, substepCount);
			},
			(_fixedDt, substep, substepCount) => {
				car.finalizeHoverStep(substep, substepCount);
			},
		);
		car.afterPhysics(1 / 60);

		simulateFrames(scene, car, input, 25);
		expect(car.getUpward().y).toBeGreaterThan(upBefore);
	});

	it("sam Q/E po skoku nie zużywa 2. skoku na dodge", () => {
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 16);
		input.setRoll(1);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(false);
		simulateFrames(scene, car, input, 8);
		expect(car.isFlipping()).toBe(false);
		expect(Math.abs(localRollRate(car))).toBeGreaterThan(0.4);
	});
});
