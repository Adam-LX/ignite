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
	simulateFrames(scene, car, input, 14);
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
		simulateFrames(scene, car, input, 20);
		const rateAfter = Math.abs(localPitchRate(car));
		expect(rateBefore).toBeGreaterThan(0.5);
		expect(rateAfter).toBeLessThan(rateBefore * 0.85);
	});

	it("W trzymane podczas frontflip kończy pełny obrót (przez 90° nose-down)", () => {
		input.setForward(1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		simulateFrames(scene, car, input, 14);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
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
		expect(maxPitch).toBeGreaterThan(1.3);
		expect(minPitch).toBeLessThan(-1.2);
	});

	it("air roll (Q/E) działa podczas diagonal flipa", () => {
		input.setForward(1);
		input.setYaw(1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 14);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);

		input.setRoll(1);
		simulateFrames(scene, car, input, 8);
		expect(Math.abs(localRollRate(car))).toBeGreaterThan(0.15);
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

		// Reset i backflip
		scene = createTestScene();
		car = createTestCar(scene);
		input = new MockControlInput();
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		simulateFrames(scene, car, input, 90);
		expect(car.isOnGround()).toBe(true);

		input.setForward(-1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 14);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		simulateFrames(scene, car, input, 3);

		const backPitchRate = localPitchRate(car);
		expect(Math.sign(backPitchRate)).toBe(-Math.sign(frontPitchRate));
	});

	it("pierwszy PPM = skok z ziemi, drugi PPM + W = od razu dodge (ta sama klatka)", () => {
		input.setForward(1);
		input.queueJump();
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);
		const vel = car.getVelocity();
		expect(Math.hypot(vel.x, vel.z)).toBeGreaterThan(4);
	});

	it("pierwszy PPM = skok, drugi PPM bez kierunku = kopa w górę (ta sama klatka)", () => {
		input.queueJump();
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(false);
		expect(car.getVelocity().y).toBeGreaterThan(4.5);
	});

	it("bez WASD drugi skok to double jump w górę, nie flip", () => {
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 14);
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
		simulateFrames(scene, car, input, 14);

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
		simulateFrames(scene, car, input, 14);
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
		simulateFrames(scene, car, input, 14);

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
		expect(maxPitchDeg).toBeLessThan(0.08);
	});

	it("W w 1. skoku + neutralny 2nd PPM prostuje pitch/roll", () => {
		input.setForward(1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setForward(0);
		simulateFrames(scene, car, input, 14);

		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(false);

		const rot = car.rapierRigidBody.rotation();
		const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
		const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
		expect(Math.abs(e.x)).toBeLessThan(0.02);
		expect(Math.abs(e.z)).toBeLessThan(0.02);
	});

	it("W trzymane przez 1. skok + frontflip nie dodaje bocznej prędkości", () => {
		input.setForward(1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		simulateFrames(scene, car, input, 14);

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

	it("W + ghost yaw 0.15 przy frontflip nie dodaje bocznej prędkości", () => {
		input.setForward(1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		simulateFrames(scene, car, input, 14);

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

	it("po zakończeniu flipa pitch/roll omega nie spada do zera (brak freeze ~270°)", () => {
		jumpThenFlip(scene, car, input);
		for (let i = 0; i < 45; i++) {
			simulateFrames(scene, car, input, 1);
			if (!car.isFlipping()) break;
		}
		expect(car.isFlipping()).toBe(false);

		const rateRightAfter = Math.abs(localPitchRate(car));
		simulateFrames(scene, car, input, 1);
		const rateRightLater = Math.abs(localPitchRate(car));
		expect(rateRightAfter).toBeGreaterThan(0.15);
		expect(rateRightLater).toBeGreaterThan(0.08);
	});

	it("frontflip kontynuuje pitch z air control (bez flatten / restartu animacji)", () => {
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);

		input.setForward(1);
		simulateFrames(scene, car, input, 18);

		const rotBefore = car.rapierRigidBody.rotation();
		const eBefore = new THREE.Euler().setFromQuaternion(
			new THREE.Quaternion(rotBefore.x, rotBefore.y, rotBefore.z, rotBefore.w),
			"YXZ",
		);
		expect(Math.abs(eBefore.x)).toBeGreaterThan(0.12);

		input.queueJump();
		simulateFrames(scene, car, input, 1);
		expect(car.isFlipping()).toBe(true);

		const rotAfter = car.rapierRigidBody.rotation();
		const eAfter = new THREE.Euler().setFromQuaternion(
			new THREE.Quaternion(rotAfter.x, rotAfter.y, rotAfter.z, rotAfter.w),
			"YXZ",
		);
		/** Nie wolno zresetować do poziomu w klatce startu flipa. */
		expect(Math.abs(eAfter.x)).toBeGreaterThan(Math.abs(eBefore.x) * 0.7);
	});

	it("PPM na dachu daje mocny recovery (unflip)", () => {
		car.rapierRigidBody.setTranslation({ x: 0, y: 0.35, z: 0 }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		car.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		car.rapierRigidBody.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
		simulateFrames(scene, car, input, 2);

		expect(car.getUpward().y).toBeLessThan(-0.5);

		const upBefore = car.getUpward().y;
		input.queueJump();
		simulateFrames(scene, car, input, 1);

		const av = car.rapierRigidBody.angvel();
		expect(Math.hypot(av.x, av.y, av.z)).toBeGreaterThan(4);
		expect(car.getVelocity().y).toBeGreaterThan(1.5);

		simulateFrames(scene, car, input, 25);
		expect(car.getUpward().y).toBeGreaterThan(upBefore);
	});
});
