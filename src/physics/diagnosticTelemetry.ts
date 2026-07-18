import * as THREE from "three";
import type Player from "../util/Player";
import { getArenaPerimeterVertices, RL_ARENA } from "../visual/arenaConstants";
import { CAM_MAX_DIST_3D, isCarInCameraFrustum } from "../visual/cameraFollow";

const CHECK_INTERVAL_SEC = 0.5;
const ANGVEL_Y_LIMIT = 3.5;
const CORNER_ZONE_RADIUS = 7;
const FLAT_NORMAL_Y = 0.98;
const PERIMETER_PHASE_START = 10;

const _cornerVerts: { x: number; z: number }[] = [];

function getCornerVerts(): { x: number; z: number }[] {
	if (_cornerVerts.length > 0) return _cornerVerts;
	const hw = RL_ARENA.HALF_WIDTH;
	const hl = RL_ARENA.HALF_LENGTH - RL_ARENA.CORNER_CUT;
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			_cornerVerts.push({ x: sx * hw, z: sz * hl });
		}
	}
	return _cornerVerts;
}

export function isInArenaCornerZone(
	x: number,
	z: number,
	radius = CORNER_ZONE_RADIUS,
): boolean {
	for (const c of getCornerVerts()) {
		if (Math.hypot(x - c.x, z - c.z) < radius) return true;
	}
	return false;
}

export function isOnPerimeterRoute(
	x: number,
	z: number,
	inset = 0.88,
): boolean {
	const verts = getArenaPerimeterVertices();
	for (let i = 0; i < verts.length; i++) {
		const a = verts[i];
		const b = verts[(i + 1) % verts.length];
		const ax = a.x * inset;
		const az = a.z * inset;
		const bx = b.x * inset;
		const bz = b.z * inset;
		const dx = bx - ax;
		const dz = bz - az;
		const lenSq = dx * dx + dz * dz;
		if (lenSq < 0.01) continue;
		const t = THREE.MathUtils.clamp(
			((x - ax) * dx + (z - az) * dz) / lenSq,
			0,
			1,
		);
		const px = ax + dx * t;
		const pz = az + dz * t;
		if (Math.hypot(x - px, z - pz) < 6) return true;
	}
	return false;
}

export class DiagnosticTelemetry {
	private lastCheckSec = -CHECK_INTERVAL_SEC;
	private readonly errors: string[] = [];
	private readonly seen = new Set<string>();

	tick(
		elapsedSec: number,
		player: Player,
		camera: THREE.PerspectiveCamera,
		ballPos: THREE.Vector3,
		isBallCam: boolean,
	): void {
		if (elapsedSec - this.lastCheckSec < CHECK_INTERVAL_SEC) return;
		this.lastCheckSec = elapsedSec;

		const carPos = player.getPosition();
		camera.updateMatrixWorld(true);

		const camDist = camera.position.distanceTo(carPos);
		const inFrustum = isCarInCameraFrustum(camera, carPos);
		if (camDist > CAM_MAX_DIST_3D || !inFrustum) {
			this.report(
				"CAMERA_FAIL",
				`[CAMERA_FAIL] Samochód opuścił pole widzenia kamery! dist=${camDist.toFixed(1)} ballCam=${isBallCam} ndcOk=${inFrustum}`,
			);
		}

		const speed = player.getVelocity().length();
		const normal = player.getSurfaceNormal();
		const inCorner = isInArenaCornerZone(carPos.x, carPos.z);
		const onPerimeterPhase = elapsedSec >= PERIMETER_PHASE_START;
		if (
			onPerimeterPhase &&
			inCorner &&
			speed > 3 &&
			player.isOnGround() &&
			normal.y >= FLAT_NORMAL_Y &&
			isOnPerimeterRoute(carPos.x, carPos.z)
		) {
			this.report(
				"GEOMETRY_FAIL",
				`[GEOMETRY_FAIL] Brak rampy w narożniku, auto jedzie po płaskiej trawie! pos=(${carPos.x.toFixed(1)}, ${carPos.z.toFixed(1)}) normal.y=${normal.y.toFixed(3)}`,
			);
		}

		const av = player.rapierRigidBody.angvel();
		if (Math.abs(av.y) > ANGVEL_Y_LIMIT) {
			this.report(
				"PHYSICS_OVERSTEER",
				`[PHYSICS_OVERSTEER] Krytyczna nadsterowność, brak trakcji kół! angvel.y=${av.y.toFixed(2)} rad/s`,
			);
		}

		void ballPos;
	}

	private report(code: string, message: string): void {
		this.errors.push(code);
		if (!this.seen.has(message)) {
			this.seen.add(message);
			if (code.startsWith("PHYSICS")) {
				console.warn(message);
			} else {
				console.error(message);
			}
		}
	}

	isClean(): boolean {
		return this.errors.length === 0;
	}

	getErrorCount(): number {
		return this.errors.length;
	}

	getUniqueErrors(): string[] {
		return [...new Set(this.errors)];
	}

	reset(): void {
		this.errors.length = 0;
		this.seen.clear();
		this.lastCheckSec = -CHECK_INTERVAL_SEC;
	}
}
