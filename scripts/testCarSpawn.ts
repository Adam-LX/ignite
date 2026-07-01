import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

if (typeof document === "undefined") {
	(globalThis as unknown as { document: Document }).document = {
		createElement: () =>
			({
				width: 0,
				height: 0,
				getContext: () => ({
					createRadialGradient: () => ({ addColorStop: () => {} }),
					fillRect: () => {},
				}),
			}) as unknown as HTMLCanvasElement,
	} as Document;
}

import Scene from "../src/Scene";
import { GameSession } from "../src/game/GameSession";
import GameObject from "../src/GameObject";
import { RL_BALL } from "../src/util/rlConstants";
import type { GameModeId } from "../src/game/modes";

async function main(): Promise<void> {
	await RAPIER.init();
	const scene = new Scene();

	const groundRb = scene.rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	scene.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(45, 0.1, 62), groundRb);

	const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.5));
	const ball = new GameObject(scene, ballMesh, {
		colliderDesc: RAPIER.ColliderDesc.ball(RL_BALL.radius).setMass(RL_BALL.mass),
		rigidBodyDesc: RAPIER.RigidBodyDesc.dynamic(),
	});
	ball.rapierRigidBody.setTranslation({ x: 0, y: 1, z: 0 }, false);

	const deps = {
		scene,
		renderer: {
			followPlayer() {},
			toggleBallCam() {},
			isBallCamEnabled: () => false,
			addCameraShake() {},
		},
		ball,
		ballRadius: RL_BALL.radius,
		ballShadow: { update() {} },
		ballVfx: { update() {} },
		hitVfx: { update() {} },
		hud: { update() {} },
		audio: {
			registerCollider() {},
			attachEngineAnchor() {},
			updateEngine() {},
			playSupersonicBreak() {},
		},
		humanInput: {
			yaw: () => 0,
			forward: () => 0,
			isBoosting: () => false,
			isShiftDown: () => false,
			isJumpHeld: () => false,
			consumeJump: () => false,
			hasFlipDirection: () => false,
			consumeBallCamToggle: () => false,
			isKeyDown: () => false,
		},
		physicsTelemetry: null,
	};

	for (const mode of ["1v1"] as GameModeId[]) {
		const session = await GameSession.create(mode, deps as never);
		console.log(`${mode}: cars=${session.cars.length} sceneObjects=${scene.gameObjects.length}`);
		for (const car of session.cars) {
			const pos = car.player.getPosition();
			console.log(
				`  spawn slot=${car.slotIndex} ${car.isHuman ? "HUMAN" : "BOT"} team=${car.visualTeam} pos=(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) visible=${car.player.threeJSGroup.visible}`,
			);
		}

		for (let frame = 0; frame < 60 * 10; frame++) {
			session.tick(deps as never, 1 / 60, frame / 60);
		}

		const bot = session.cars.find((c) => !c.isHuman)!;
		const ballMoved = ball.getPosition().distanceTo(new THREE.Vector3(0, 1, 0));

		for (const car of session.cars) {
			const pos = car.player.getPosition();
			console.log(
				`  after10s slot=${car.slotIndex} ${car.isHuman ? "HUMAN" : "BOT"} pos=(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`,
			);
		}
		console.log(`  ball dist from kickoff: ${ballMoved.toFixed(2)}m`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
