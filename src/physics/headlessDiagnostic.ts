import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { AUTOPILOT_DURATION_SEC } from "../debug/config";
import { auditSceneLighting } from "../diagnostic/lightingAudit";
import Scene from "../Scene";
import type GameInput from "../util/GameInput";
import Player from "../util/Player";
import { buildArenaPhysics } from "../visual/arena";
import {
	BASE_FOV,
	createChaseCameraState,
	horizontalFovToVertical,
	updateChaseCamera,
} from "../visual/cameraFollow";
import { getAutopilotDrive, readCarYaw } from "./autopilot";
import { DiagnosticTelemetry } from "./diagnosticTelemetry";

type SyntheticDrive = {
	forward: number;
	yaw: number;
	boost: boolean;
};

class SyntheticInput {
	private drive: SyntheticDrive = { forward: 0, yaw: 0, boost: false };

	setDrive(d: SyntheticDrive): void {
		this.drive = d;
	}

	forward(): number {
		return this.drive.forward;
	}

	yaw(): number {
		return this.drive.yaw;
	}

	roll(): number {
		return 0;
	}

	isBoosting(): boolean {
		return this.drive.boost;
	}

	isShiftDown(): boolean {
		return false;
	}

	isJumpHeld(): boolean {
		return false;
	}

	consumeRecover(): boolean {
		return false;
	}
	peekJump(): boolean {
		return false;
	}

	consumeJump(): boolean {
		return false;
	}

	consumeBallCamToggle(): boolean {
		return false;
	}

	hasFlipDirection(): boolean {
		return false;
	}
}

export async function runHeadlessDiagnosticAutopilot(): Promise<{
	passed: boolean;
	errors: string[];
	elapsed: number;
}> {
	await RAPIER.init();

	const scene = new Scene();
	buildArenaPhysics(scene.rapierWorld);
	auditSceneLighting(scene.threeJSScene);

	const carMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6));
	const player = new Player(scene, carMesh);
	player.rapierRigidBody.setTranslation({ x: 0, y: 1.4, z: -12 }, false);

	const input = new SyntheticInput();
	const aspect = 16 / 9;
	const camera = new THREE.PerspectiveCamera(
		horizontalFovToVertical(BASE_FOV, aspect),
		aspect,
		0.1,
		2500,
	);
	const chaseState = createChaseCameraState(BASE_FOV);
	const telemetry = new DiagnosticTelemetry();
	const ballPos = new THREE.Vector3(0, 1.7, 0);

	const dt = 1 / 60;
	let elapsed = 0;

	while (elapsed < AUTOPILOT_DURATION_SEC) {
		input.setDrive(
			getAutopilotDrive(elapsed, player.getPosition(), readCarYaw(player)),
		);
		player.control(input as unknown as GameInput, dt);
		const physicsStep = scene.advancePhysics(dt);
		const simDt = physicsStep.fixedDt * Math.max(1, physicsStep.steps);
		player.afterPhysics(simDt);

		const rot = player.rapierRigidBody.rotation();
		const carQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
		updateChaseCamera(
			camera,
			player.getPosition(),
			carQuat,
			ballPos,
			false,
			dt,
			input.isBoosting(),
			player.getVelocity().length(),
			chaseState,
			undefined,
			Math.hypot(player.getVelocity().x, player.getVelocity().z),
			0,
			0,
			false,
			player.getVelocity(),
		);

		telemetry.tick(elapsed, player, camera, ballPos, false);
		elapsed += dt;
	}

	return {
		passed: telemetry.isClean(),
		errors: telemetry.getUniqueErrors(),
		elapsed,
	};
}
