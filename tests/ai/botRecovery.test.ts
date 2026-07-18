import { describe, expect, it } from "vitest";
import * as THREE from "three";

import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
import {
	computeMatchRecoveryEfficiency,
	isBotStableOnWheels,
	isBotUnstable,
} from "../../src/ai/botRecovery";
import { resolveLearnedDrive } from "../../src/ai/learning/BotLearningTuning";
import type { JumpGateContext } from "../../src/ai/learning/BotJumpResolver";

function makeCar(): RocketCar {
	const scene = new Scene();
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
	return new RocketCar(scene, mesh);
}

describe("botRecovery", () => {
	it("wykrywa turtle (dach)", () => {
		const car = makeCar();
		car.rapierRigidBody.setRotation(
			{ x: 1, y: 0, z: 0, w: 0 },
			true,
		);
		expect(isBotUnstable(car)).toBe(true);
	});

	it("stabilny hover nie jest unstable", () => {
		const car = makeCar();
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: 0 }, true);
		expect(isBotUnstable(car)).toBe(false);
	});

	it("wall-ride (normalna ściany) nie jest unstable gdy koła w bandę", () => {
		const car = makeCar();
		// up = −X, jak na ścianie +X
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
		// Symuluj kontakt ze ścianą (grace + normalna).
		(car as unknown as { wallContactLeft: number }).wallContactLeft = 0.2;
		(car as unknown as { surfaceNormal: THREE.Vector3 }).surfaceNormal.set(
			-1,
			0,
			0,
		);
		(car as unknown as { wheelsGrounded: number }).wheelsGrounded = 4;
		expect(isBotUnstable(car)).toBe(false);
		expect(isBotStableOnWheels(car)).toBe(true);
	});

	it("computeMatchRecoveryEfficiency — brak problemów = 1", () => {
		expect(computeMatchRecoveryEfficiency(0, 50, [])).toBe(1);
	});
});

describe("BotLearning recovery bypass", () => {
	it("forceRecovery blokuje boost z sieci", () => {
		const gate: JumpGateContext = {
			forceRecovery: true,
			forcedJump: false,
			inAir: false,
			onGround: true,
			ballAirborne: false,
			ballAboveBot: false,
			ballY: 0.5,
			horizDist: 20,
			defending: false,
			looseBall: false,
			goalieOrClearance: false,
		};
		const out = new Float32Array(12).fill(1);
		const drive = resolveLearnedDrive(
			{ forward: 1, yaw: 0, boost: true, jump: true },
			{
				policyOutputs: out,
				tuning: {
					interceptLead: 1,
					boostDistanceMul: 1,
					challengeRadiusMul: 1,
					aggression: 1,
					boostBias: 1,
					defenseBias: 0,
					aerialBias: 0.5,
					targetLateral: 0,
					targetLead: 0,
					targetHeight: 0,
					aerialHeightBias: 0,
					strikeApproach: 0,
					steerBlend: 1,
					aerialSteerBlend: 1,
					aimOffsetX: 0,
					aimOffsetY: 0,
					aimOffsetZ: 0,
					policyAutonomy: 1,
				},
				maturity: 1,
				jumpGate: gate,
				heuristicJump: true,
			},
		);
		expect(drive.jump).toBe(true);
		expect(drive.boost).toBe(true);
	});
});
