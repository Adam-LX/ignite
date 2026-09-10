import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { describe, expect, it, beforeAll } from "vitest";

import GameObject from "../../src/GameObject";
import RocketCar from "../../src/physics/RocketCar";
import Scene from "../../src/Scene";
import {
	applyCarBallHitsAll,
	snapshotBallKinematics,
	updateBallPhysics,
} from "../../src/util/rlContacts";
import { RL_BALL, RL_CAR } from "../../src/util/rlConstants";
import { mpsToUu, rlBallCarExtraImpulseFactor } from "../../src/util/rlPhysics";
import { buildArenaPhysics } from "../../src/visual/arena";
import { FRAME_DT } from "./harness";

beforeAll(async () => {
	await RAPIER.init();
});

/** Ten sam wzór co RocketCar.updateBallSteerContext — kontrakt redukcji yaw przy piłce. */
function steerMulAtBallDistance(dist: number): number {
	const t = THREE.MathUtils.clamp(1 - dist / RL_CAR.steerNearBallRadius, 0, 1);
	return THREE.MathUtils.lerp(1, RL_CAR.steerNearBallMul, t * t);
}

function createBall(scene: Scene): GameObject {
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(RL_BALL.radius));
	const ball = new GameObject(scene, mesh, {
		colliderDesc: RAPIER.ColliderDesc.ball(RL_BALL.radius)
			.setRestitution(0)
			.setMass(RL_BALL.mass)
			.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
			.setFriction(RL_BALL.groundFriction),
		rigidBodyDesc: RAPIER.RigidBodyDesc.dynamic()
			.setLinearDamping(RL_BALL.airLinearDamp)
			.setAngularDamping(RL_BALL.airAngularDamp)
			.setCcdEnabled(true),
	});
	ball.rapierRigidBody.setTranslation(
		{ x: 0, y: RL_BALL.radius + 0.08, z: 0 },
		true,
	);
	return ball;
}

describe("Kontakt auto–piłka (RL feel)", () => {
	it("Psyonix curve — power-shot Δv (~1600 uu/s) ma sensowny mnożnik", () => {
		const factor = rlBallCarExtraImpulseFactor(1600) * RL_BALL.extraForceScale;
		expect(factor).toBeGreaterThan(0.58);
		expect(factor).toBeLessThan(0.72);
	});

	it("redukcja skrętu przy piłce — blisko mocniej, daleko prawie pełny yaw", () => {
		expect(steerMulAtBallDistance(2)).toBeLessThan(0.8);
		expect(steerMulAtBallDistance(8)).toBeGreaterThan(0.88);
		expect(steerMulAtBallDistance(RL_CAR.steerNearBallRadius + 2)).toBe(1);
	});

	it("twardy hit ~18 m/s przekazuje ≥10 m/s poziomo (power shot)", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);
		const ball = createBall(scene);
		ball.rapierRigidBody.setTranslation(
			{ x: 0, y: RL_BALL.radius + 0.08, z: -8 },
			true,
		);

		const car = new RocketCar(
			scene,
			new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6)),
		);
		car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: -12 }, true);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 18 }, true);

		let peakHoriz = 0;
		for (let i = 0; i < 30; i++) {
			snapshotBallKinematics(ball);
			scene.advancePhysics(FRAME_DT, (fixedDt, substep, substepCount) => {
				car.integrateHover(fixedDt, substep, substepCount);
			});
			car.afterPhysics(FRAME_DT);
			applyCarBallHitsAll(scene.rapierWorld, [car], ball);
			updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
			ball.syncWithRigidBody();
			const v = ball.rapierRigidBody.linvel();
			peakHoriz = Math.max(peakHoriz, Math.hypot(v.x, v.z));
		}

		expect(peakHoriz).toBeGreaterThan(10);
		expect(peakHoriz).toBeLessThan(RL_BALL.maxSpeed);
	});

	it("minApproachSpeed rejestruje wolniejsze zbliżanie niż stary próg 0.55 m/s", () => {
		expect(RL_BALL.minApproachSpeed).toBeLessThan(0.55);
		expect(mpsToUu(RL_BALL.minApproachSpeed)).toBeLessThan(55);
	});
});
