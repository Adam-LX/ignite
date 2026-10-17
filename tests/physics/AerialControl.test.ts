import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
import {
	createTestCar,
	createTestScene,
	MockControlInput,
	simulateFrames,
	localPitchRate,
	localRollRate,
} from "./harness";

vi.mock("../../src/debug/config", () => ({
	HOVER_SAFE_MODE: false,
	HOVER_DEBUG_RAYS: false,
	HOVER_FORCE_MAX: 50_000,
	HOVER_TELEMETRY_EVERY_STEPS: 0,
	DEBUG_AUTOPILOT: false,
	AUTOPILOT_DURATION_SEC: 20,
}));

function jumpToAir(scene: Scene, car: RocketCar, input: MockControlInput): void {
	car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
	simulateFrames(scene, car, input, 90);
	input.setJumpHeld(true);
	input.queueJump();
	simulateFrames(scene, car, input, 1);
	input.setJumpHeld(false);
	simulateFrames(scene, car, input, 8);
	expect(car.isOnGround()).toBe(false);
}

describe("RocketCar — aerial control (M2.5 P1)", () => {
	let scene: Scene;
	let car: RocketCar;
	let input: MockControlInput;

	beforeEach(() => {
		scene = createTestScene();
		car = createTestCar(scene);
		input = new MockControlInput();
	});

	it("boost w powietrzu przyspiesza bardziej niż bez boosta", () => {
		jumpToAir(scene, car, input);

		const speedNoBoost = car.getVelocity().length();
		simulateFrames(scene, car, input, 15);
		const gainNoBoost =
			car.getVelocity().length() - speedNoBoost;

		jumpToAir(scene, car, input);
		const speedWithBoost = car.getVelocity().length();
		input.setForward(1);
		input.setBoosting(true);
		simulateFrames(scene, car, input, 15);
		const gainWithBoost =
			car.getVelocity().length() - speedWithBoost;

		expect(gainWithBoost).toBeGreaterThan(gainNoBoost * 1.15);
	});

	it("yaw w powietrzu reaguje na stick (aerial control aktywny)", () => {
		jumpToAir(scene, car, input);
		const fwdBefore = car.getForward().clone();
		input.setYaw(1);
		simulateFrames(scene, car, input, 35);
		expect(car.isOnGround()).toBe(false);
		const turn = Math.abs(fwdBefore.angleTo(car.getForward()));
		expect(turn).toBeGreaterThan(0.08);
	});

	it("Q/E po skoku to air roll, nie dodge (także przy trzymanym PPM)", () => {
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		simulateFrames(scene, car, input, 90);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		simulateFrames(scene, car, input, 22);
		expect(car.isOnGround()).toBe(false);
		expect(car.isFlipping()).toBe(false);

		input.setRoll(1);
		simulateFrames(scene, car, input, 10);
		expect(car.isFlipping()).toBe(false);
		expect(Math.abs(localRollRate(car))).toBeGreaterThan(0.45);
	});

	it("trzymany PPM + W + Q = pitch i roll, bez flipa", () => {
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		simulateFrames(scene, car, input, 90);
		input.setForward(1);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setRoll(1);
		simulateFrames(scene, car, input, 20);
		expect(car.isFlipping()).toBe(false);
		expect(Math.abs(localPitchRate(car))).toBeGreaterThan(0.25);
		expect(Math.abs(localRollRate(car))).toBeGreaterThan(0.35);
	});

	it("tuż po skoku W/S ma pełny air pitch (bez attenuacji przy murawie)", () => {
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		simulateFrames(scene, car, input, 90);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setForward(1);
		simulateFrames(scene, car, input, 12);
		expect(car.isOnGround()).toBe(false);
		expect(car.isFlipping()).toBe(false);
		expect(Math.abs(localPitchRate(car))).toBeGreaterThan(0.45);
	});

	it("skok+W nie wbija nosa w murawę (brak scrape jak w RL)", () => {
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		simulateFrames(scene, car, input, 90);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setForward(1);
		/** Pomiń takeoff — mierzymy pitch scrape w locie (klip 10-52). */
		simulateFrames(scene, car, input, 4);
		let minNoseY = Infinity;
		let sawNoseDown = false;
		for (let i = 0; i < 32; i++) {
			simulateFrames(scene, car, input, 1);
			if (car.isOnGround()) break;
			const pos = car.getPosition();
			const fwd = car.getForward();
			const up = car.getUpward();
			const noseY = pos.y + fwd.y * 0.59 - up.y * 0.18;
			minNoseY = Math.min(minNoseY, noseY);
			if (fwd.y < -0.1) sawNoseDown = true;
		}
		expect(minNoseY).toBeGreaterThan(0.12);
		expect(sawNoseDown).toBe(true);
	});

	it("skok+S nie wciska tyłu w murawę", () => {
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		simulateFrames(scene, car, input, 90);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setForward(-1);
		simulateFrames(scene, car, input, 4);
		let minTailY = Infinity;
		let maxFy = -Infinity;
		for (let i = 0; i < 32; i++) {
			simulateFrames(scene, car, input, 1);
			if (car.isOnGround()) break;
			const pos = car.getPosition();
			const fwd = car.getForward();
			const up = car.getUpward();
			const tailY = pos.y - fwd.y * 0.59 - up.y * 0.18;
			minTailY = Math.min(minTailY, tailY);
			maxFy = Math.max(maxFy, fwd.y);
		}
		expect(minTailY).toBeGreaterThan(0.12);
		expect(maxFy).toBeGreaterThan(0.1);
	});

	it("po skoku + S ląduje — nie staje na nosie w nieskończoność (klip 01-36)", () => {
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		simulateFrames(scene, car, input, 90);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setForward(-1);
		let landed = false;
		for (let i = 0; i < 120; i++) {
			simulateFrames(scene, car, input, 1);
			if (car.isOnGround()) {
				landed = true;
				break;
			}
		}
		expect(landed).toBe(true);
		simulateFrames(scene, car, input, 30);
		expect(car.isOnGround()).toBe(true);
		expect(car.isFlipping()).toBe(false);
		expect(car.getUpward().y).toBeGreaterThan(0.45);
		expect(car.getForward().y).toBeGreaterThan(-0.75);
	});

	it("przy nosie w górę nad murawą W nadal pitchuje (wyjście ze stójki)", () => {
		jumpToAir(scene, car, input);
		const noseUp = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(-1.05, 0, 0, "YXZ"),
		);
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.55, z: 0 }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0.15, z: 0 }, true);
		car.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		car.rapierRigidBody.setRotation(
			{ x: noseUp.x, y: noseUp.y, z: noseUp.z, w: noseUp.w },
			true,
		);
		expect(car.getForward().y).toBeGreaterThan(0.72);
		input.setForward(1);
		simulateFrames(scene, car, input, 10);
		expect(car.isFlipping()).toBe(false);
		expect(Math.abs(localPitchRate(car))).toBeGreaterThan(0.15);
	});

	it("1×PPM + W robi pełną pętlę pitch (~360°, nie strop przy pionie)", () => {
		car.applyDevSpawnPose({
			x: 0,
			y: 4.2,
			z: 0,
			yawY: 0,
			pitch: 0,
			jumpCount: 1,
			grounded: false,
			vel: { x: 0, y: 1.2, z: 0 },
		});
		input.setForward(1);
		let pitchAccum = 0;
		let prevRate = localPitchRate(car);
		for (let i = 0; i < 90; i++) {
			simulateFrames(scene, car, input, 1);
			const rate = localPitchRate(car);
			pitchAccum += Math.abs(rate) * (1 / 60);
			prevRate = rate;
			void prevRate;
			if (pitchAccum > Math.PI * 2.05) break;
		}
		expect(pitchAccum).toBeGreaterThan(Math.PI * 1.85);
		expect(car.isFlipping()).toBe(false);
	});

	it("PPM+W przy murawie: da się ustawić ~90° i utrzymać po puszczeniu W", () => {
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		simulateFrames(scene, car, input, 60);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setForward(1);
		let reached = false;
		for (let i = 0; i < 40; i++) {
			simulateFrames(scene, car, input, 1);
			if (car.getForward().y < -0.9 && Math.abs(car.getUpward().y) < 0.45) {
				reached = true;
				break;
			}
		}
		expect(reached).toBe(true);
		const fyAt = car.getForward().y;
		input.setForward(0);
		simulateFrames(scene, car, input, 18);
		/** Tip/unstick nie ściąga ze stójki w ciągu ~0.3 s. */
		expect(car.getForward().y).toBeLessThan(fyAt + 0.35);
		expect(Math.abs(car.getForward().y)).toBeGreaterThan(0.7);
	});

	it("PPM+S partial: dojście do ~90° nosa w górę bez ucięcia pitchu", () => {
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		simulateFrames(scene, car, input, 60);
		input.setJumpHeld(true);
		input.queueJump();
		simulateFrames(scene, car, input, 1);
		input.setJumpHeld(false);
		input.setForward(-0.5);
		let maxFy = -Infinity;
		for (let i = 0; i < 40; i++) {
			simulateFrames(scene, car, input, 1);
			maxFy = Math.max(maxFy, car.getForward().y);
		}
		expect(maxFy).toBeGreaterThan(0.88);
	});

	it("Shift+A kręci w tę samą stronę co Q (roll −1)", () => {
		jumpToAir(scene, car, input);
		car.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		input.setRoll(-1);
		simulateFrames(scene, car, input, 12);
		const qRate = localRollRate(car);
		expect(Math.abs(qRate)).toBeGreaterThan(0.4);

		input.setRoll(0);
		car.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		input.setShift(true);
		input.setYaw(1);
		simulateFrames(scene, car, input, 12);
		const aRate = localRollRate(car);
		expect(Math.abs(aRate)).toBeGreaterThan(0.4);
		expect(Math.sign(aRate)).toBe(Math.sign(qRate));
	});
});
