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
import { RL_BALL } from "../../src/util/rlConstants";
import { RL_ARENA } from "../../src/visual/arenaConstants";
import { buildArenaPhysics } from "../../src/visual/arena";
import { detectGoalScored } from "../../src/visual/arena";
import { FRAME_DT, MockControlInput } from "./harness";

beforeAll(async () => {
	await RAPIER.init();
});

function createBall(scene: Scene): GameObject {
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(RL_BALL.radius));
	const ball = new GameObject(scene, mesh, {
		colliderDesc: RAPIER.ColliderDesc.ball(RL_BALL.radius)
			.setRestitution(0)
			.setMass(RL_BALL.mass)
			.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
			.setFriction(RL_BALL.groundFriction)
			.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS),
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

/** Kolejność jak w GameSession: physics → smish/tarcie piłki. */
function simulateBallRolling(
	scene: Scene,
	ball: GameObject,
	frames: number,
): void {
	for (let i = 0; i < frames; i++) {
		snapshotBallKinematics(ball);
		scene.advancePhysics(FRAME_DT);
		updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
		ball.syncWithRigidBody();
	}
}

function simulateCarBallHit(
	scene: Scene,
	car: RocketCar,
	ball: GameObject,
	frames: number,
	beforeStep?: () => void,
): void {
	for (let i = 0; i < frames; i++) {
		beforeStep?.();
		snapshotBallKinematics(ball);
		scene.advancePhysics(FRAME_DT, (fixedDt) => {
			car.integrateHover(fixedDt);
		});
		car.afterPhysics(FRAME_DT);
		applyCarBallHitsAll(scene.rapierWorld, [car], ball);
		updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
		ball.syncWithRigidBody();
	}
}

describe("Balans piłki", () => {
	it("toczy się dalej po murawie — nie zatrzymuje się w 2 s", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);
		const ball = createBall(scene);
		ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 6 }, true);

		simulateBallRolling(scene, ball, Math.round(2 / FRAME_DT));

		const v = ball.rapierRigidBody.linvel();
		const horiz = Math.hypot(v.x, v.z);
		expect(horiz).toBeGreaterThan(2.8);
		expect(horiz).toBeLessThan(6.5);
	});

	it("powolny rolling wchodzi w bramkę", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);
		const ball = createBall(scene);
		const startZ = RL_ARENA.HALF_LENGTH - 1.2;
		ball.rapierRigidBody.setTranslation(
			{ x: 0, y: RL_BALL.radius + 0.08, z: startZ },
			true,
		);
		ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 4.5 }, true);

		let scored: string | null = null;
		for (let i = 0; i < Math.round(4 / FRAME_DT); i++) {
			snapshotBallKinematics(ball);
			scene.advancePhysics(FRAME_DT);
			updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
			ball.syncWithRigidBody();
			scored = detectGoalScored(ball.getPosition(), RL_BALL.radius);
			if (scored) break;
		}

		expect(scored).toBe("blue");
	});

	it("delikatne szturchnięcie (~3 m/s) porusza piłkę", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);
		const ball = createBall(scene);
		ball.rapierRigidBody.setTranslation(
			{ x: 0, y: RL_BALL.radius + 0.08, z: -4 },
			true,
		);

		const carMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
		const car = new RocketCar(scene, carMesh);
		car.rapierRigidBody.setTranslation(
			{ x: 0, y: 1.4, z: -6.5 },
			true,
		);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 3.2 }, true);

		simulateCarBallHit(scene, car, ball, 40);

		const v = ball.rapierRigidBody.linvel();
		const horiz = Math.hypot(v.x, v.z);
		expect(horiz).toBeGreaterThan(0.8);
	});

	it("uderzenie auta ~16 m/s nadaje piłce sensowną prędkość (bez mega pionu)", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);
		const ball = createBall(scene);
		ball.rapierRigidBody.setTranslation(
			{ x: 0, y: RL_BALL.radius + 0.08, z: -8 },
			true,
		);

		const carMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
		const car = new RocketCar(scene, carMesh);
		car.rapierRigidBody.setTranslation(
			{ x: 0, y: 1.4, z: -12 },
			true,
		);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 16 }, true);

		simulateCarBallHit(scene, car, ball, 30);

		const v = ball.rapierRigidBody.linvel();
		const horiz = Math.hypot(v.x, v.z);
		expect(horiz).toBeGreaterThan(8);
		expect(Math.abs(v.y)).toBeLessThan(8);
		expect(horiz).toBeLessThan(RL_BALL.maxSpeed);
	});

	it("uderzenie z komponentem w górę podbija piłkę", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);
		const ball = createBall(scene);
		ball.rapierRigidBody.setTranslation(
			{ x: 0, y: RL_BALL.radius + 0.08, z: -8 },
			true,
		);

		const carMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
		const car = new RocketCar(scene, carMesh);
		car.rapierRigidBody.setTranslation(
			{ x: 0, y: 1.4, z: -12 },
			true,
		);
		car.rapierRigidBody.setLinvel({ x: 0, y: 3.5, z: 16 }, true);

		let maxVy = 0;
		for (let i = 0; i < 25; i++) {
			snapshotBallKinematics(ball);
			scene.advancePhysics(FRAME_DT, (fixedDt) => {
				car.integrateHover(fixedDt);
			});
			car.afterPhysics(FRAME_DT);
			applyCarBallHitsAll(scene.rapierWorld, [car], ball);
			updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
			ball.syncWithRigidBody();
			maxVy = Math.max(maxVy, ball.rapierRigidBody.linvel().y);
		}

		expect(maxVy).toBeGreaterThan(0.85);
	});

	it("płaskie uderzenie ma mniejszy loft niż z komponentem w górę", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);

		function loftForCarVy(carVy: number): number {
			const ball = createBall(scene);
			ball.rapierRigidBody.setTranslation(
				{ x: 0, y: RL_BALL.radius + 0.08, z: -8 },
				true,
			);
			const carMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
			const car = new RocketCar(scene, carMesh);
			car.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: -12 }, true);
			car.rapierRigidBody.setLinvel({ x: 0, y: carVy, z: 16 }, true);

			let maxVy = 0;
			for (let i = 0; i < 25; i++) {
				snapshotBallKinematics(ball);
				scene.advancePhysics(FRAME_DT, (fixedDt) => {
					car.integrateHover(fixedDt);
				});
				car.afterPhysics(FRAME_DT);
				applyCarBallHitsAll(scene.rapierWorld, [car], ball);
				updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
				ball.syncWithRigidBody();
				maxVy = Math.max(maxVy, ball.rapierRigidBody.linvel().y);
			}
			return maxVy;
		}

		const flatLoft = loftForCarVy(0);
		const climbingLoft = loftForCarVy(4);
		expect(climbingLoft).toBeGreaterThan(flatLoft + 0.03);
	});

	it("spadek z 3 m — żywy rebound (CR≈0.6, nie kangur)", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);
		const ball = createBall(scene);
		ball.rapierRigidBody.setTranslation(
			{ x: 0, y: 3, z: 0 },
			true,
		);
		ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);

		let touchedGround = false;
		let firstBouncePeak = RL_BALL.radius;
		for (let i = 0; i < Math.round(3 / FRAME_DT); i++) {
			snapshotBallKinematics(ball);
			scene.advancePhysics(FRAME_DT);
			updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
			ball.syncWithRigidBody();
			const y = ball.getPosition().y;
			const vy = ball.rapierRigidBody.linvel().y;
			if (!touchedGround && y <= RL_BALL.radius + 0.12) {
				touchedGround = true;
			}
			if (touchedGround) {
				firstBouncePeak = Math.max(firstBouncePeak, y);
			}
			if (touchedGround && vy < -1 && firstBouncePeak > RL_BALL.radius + 0.25) {
				break;
			}
		}

		expect(firstBouncePeak).toBeGreaterThan(1.55);
		expect(firstBouncePeak).toBeLessThan(2.35);
	});

	it("odbija się od ściany bocznej", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);
		const ball = createBall(scene);
		const margin = RL_BALL.radius + 0.2;
		ball.rapierRigidBody.setTranslation(
			{ x: RL_ARENA.HALF_WIDTH - margin - 1.5, y: RL_BALL.radius + 0.5, z: 0 },
			true,
		);
		ball.rapierRigidBody.setLinvel({ x: 14, y: 0, z: 0 }, true);

		let minX = Infinity;
		for (let i = 0; i < Math.round(1.5 / FRAME_DT); i++) {
			snapshotBallKinematics(ball);
			scene.advancePhysics(FRAME_DT);
			updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
			ball.syncWithRigidBody();
			minX = Math.min(minX, ball.getPosition().x);
		}

		const v = ball.rapierRigidBody.linvel();
		expect(minX).toBeLessThan(RL_ARENA.HALF_WIDTH - margin);
		expect(v.x).toBeLessThan(-2);
	});

	it("spin przy odbiciu od murawy przekłada się na ruch poziomy (smish)", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);
		const ball = createBall(scene);
		ball.rapierRigidBody.setTranslation(
			{ x: 0, y: RL_BALL.radius + 0.02, z: 0 },
			true,
		);
		ball.rapierRigidBody.setLinvel({ x: 0, y: -4, z: 0 }, true);
		ball.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 8 }, true);

		for (let i = 0; i < 8; i++) {
			snapshotBallKinematics(ball);
			scene.advancePhysics(FRAME_DT);
			updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
			ball.syncWithRigidBody();
		}

		const v = ball.rapierRigidBody.linvel();
		expect(Math.hypot(v.x, v.z)).toBeGreaterThan(0.35);
	});

	it("odbija się od narożnika areny (rampa / ściana)", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);
		const ball = createBall(scene);
		const hw = RL_ARENA.HALF_WIDTH - RL_BALL.radius - 1.2;
		const hl = RL_ARENA.HALF_LENGTH - RL_BALL.radius - 1.2;
		ball.rapierRigidBody.setTranslation(
			{ x: hw - 4, y: RL_BALL.radius + 1.2, z: hl - 4 },
			true,
		);
		ball.rapierRigidBody.setLinvel({ x: 12, y: 0, z: 12 }, true);

		let minX = Infinity;
		let minZ = Infinity;
		for (let i = 0; i < Math.round(1.2 / FRAME_DT); i++) {
			snapshotBallKinematics(ball);
			scene.advancePhysics(FRAME_DT);
			updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
			ball.syncWithRigidBody();
			const p = ball.getPosition();
			minX = Math.min(minX, p.x);
			minZ = Math.min(minZ, p.z);
		}

		const v = ball.rapierRigidBody.linvel();
		expect(minX).toBeLessThan(hw);
		expect(minZ).toBeLessThan(hl);
		expect(v.x).toBeLessThan(8);
		expect(v.z).toBeLessThan(8);
	});

	it("boost hit nie strzela pod sufit (cap pionu)", () => {
		const scene = new Scene();
		buildArenaPhysics(scene.rapierWorld);
		const ball = createBall(scene);
		ball.rapierRigidBody.setTranslation(
			{ x: 0, y: RL_BALL.radius + 0.08, z: -8 },
			true,
		);

		const input = new MockControlInput();
		input.setBoosting(true);
		const carMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
		const car = new RocketCar(scene, carMesh);
		car.rapierRigidBody.setTranslation(
			{ x: 0, y: 1.4, z: -12 },
			true,
		);
		car.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 20 }, true);

		let maxVy = 0;
		let maxY = RL_BALL.radius;
		for (let i = 0; i < 40; i++) {
			snapshotBallKinematics(ball);
			car.control(input, FRAME_DT);
			scene.advancePhysics(FRAME_DT, (fixedDt) => {
				car.integrateHover(fixedDt);
			});
			car.afterPhysics(FRAME_DT);
			applyCarBallHitsAll(scene.rapierWorld, [car], ball);
			updateBallPhysics(ball, RL_BALL.radius, FRAME_DT, scene.rapierWorld);
			ball.syncWithRigidBody();
			const v = ball.rapierRigidBody.linvel();
			maxVy = Math.max(maxVy, Math.abs(v.y));
			maxY = Math.max(maxY, ball.getPosition().y);
		}

		expect(maxVy).toBeLessThanOrEqual(RL_BALL.maxBoostHitVertSpeed + 0.5);
		expect(maxY).toBeLessThan(18);
	});
});
