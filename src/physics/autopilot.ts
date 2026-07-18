import * as THREE from "three";

import { AUTOPILOT_DURATION_SEC } from "../debug/config";
import type Renderer from "../Renderer";
import type GameInput from "../util/GameInput";
import type Player from "../util/Player";
import { RL_ARENA } from "../visual/arenaConstants";
import { buildPerimeterSegments, RAMP_WIDTH } from "../visual/arenaPerimeter";
import { DiagnosticTelemetry } from "./diagnosticTelemetry";

export type AutopilotDrive = {
	forward: number;
	yaw: number;
	boost: boolean;
};

const RAMP_RUN = RAMP_WIDTH;
const WAYPOINT_RADIUS = 5.5;

const _wpScratch = new THREE.Vector2();

function isGoalEndSegment(midX: number, midZ: number): boolean {
	const hl = RL_ARENA.HALF_LENGTH;
	const gw = RL_ARENA.GOAL_WIDTH / 2;
	return Math.abs(Math.abs(midZ) - hl) < 0.5 && Math.abs(midX) < gw;
}

/** Punkty jazdy w połowie wstęgi rampy (nie na płaskiej murawie). */
function buildRampDriveWaypoints(): THREE.Vector3[] {
	const segments = buildPerimeterSegments();
	const points: THREE.Vector3[] = [];
	const rampMid = RAMP_RUN * 0.55;

	for (const seg of segments) {
		const midX = (seg.ax + seg.bx) * 0.5;
		const midZ = (seg.az + seg.bz) * 0.5;
		if (isGoalEndSegment(midX, midZ)) continue;

		points.push(
			new THREE.Vector3(
				midX + seg.outX * rampMid,
				0,
				midZ + seg.outZ * rampMid,
			),
		);
	}
	return points;
}

let cachedWaypoints: THREE.Vector3[] | null = null;

function perimeterWaypoints(): THREE.Vector3[] {
	if (!cachedWaypoints) cachedWaypoints = buildRampDriveWaypoints();
	return cachedWaypoints;
}

/** Wejście syntetyczne według sztywnego scenariusza 0–20 s. */
export function getAutopilotDrive(
	elapsedSec: number,
	carPos: THREE.Vector3,
	carYaw: number,
): AutopilotDrive {
	if (elapsedSec < 5) {
		return { forward: 1, yaw: 0, boost: false };
	}

	if (elapsedSec < 10) {
		return { forward: 1, yaw: 1, boost: true };
	}

	const waypoints = perimeterWaypoints();
	const phaseT = (elapsedSec - 10) / 10;
	const wpIndex = Math.min(
		waypoints.length - 1,
		Math.floor(phaseT * waypoints.length),
	);
	const target = waypoints[wpIndex];
	const next = waypoints[(wpIndex + 1) % waypoints.length];

	_wpScratch.set(
		target.x + (next.x - target.x) * 0.35 - carPos.x,
		target.z + (next.z - target.z) * 0.35 - carPos.z,
	);
	if (_wpScratch.length() < WAYPOINT_RADIUS) {
		const alt = waypoints[(wpIndex + 2) % waypoints.length];
		_wpScratch.set(alt.x - carPos.x, alt.z - carPos.z);
	}

	const desiredYaw = Math.atan2(_wpScratch.x, _wpScratch.y);
	let diff = desiredYaw - carYaw;
	while (diff > Math.PI) diff -= Math.PI * 2;
	while (diff < -Math.PI) diff += Math.PI * 2;

	const yaw = THREE.MathUtils.clamp(diff * 2.4, -1, 1);
	return { forward: 1, yaw, boost: true };
}

export function readCarYaw(player: Player): number {
	const rot = player.rapierRigidBody.rotation();
	const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
	const euler = new THREE.Euler().setFromQuaternion(q, "YXZ");
	return euler.y;
}

/** Autopilot diagnostyczny — steruje GameInput i zbiera telemetrię. */
export class DiagnosticAutopilot {
	readonly telemetry = new DiagnosticTelemetry();
	private readonly startTime = performance.now();
	private finished = false;
	private passed = false;

	isActive(): boolean {
		return !this.finished;
	}

	hasPassed(): boolean {
		return this.passed;
	}

	getElapsedSec(): number {
		return (performance.now() - this.startTime) / 1000;
	}

	update(
		player: Player,
		renderer: Renderer,
		ballPos: THREE.Vector3,
		input: GameInput,
	): void {
		const elapsed = this.getElapsedSec();
		if (elapsed >= AUTOPILOT_DURATION_SEC) {
			if (!this.finished) {
				this.finished = true;
				this.passed = this.telemetry.isClean();
				if (this.passed) {
					console.log("[AUTOPILOT] PASS — 20s bez błędów diagnostycznych.");
				} else {
					console.error(
						`[AUTOPILOT] FAIL — ${this.telemetry.getErrorCount()} błędów:`,
						this.telemetry.getUniqueErrors(),
					);
				}
			}
			input.setAutopilotDrive(null);
			return;
		}

		renderer.setBallCamEnabled(false);

		const carPos = player.getPosition();
		const drive = getAutopilotDrive(elapsed, carPos, readCarYaw(player));
		input.setAutopilotDrive(drive);

		this.telemetry.tick(
			elapsed,
			player,
			renderer.threeJSCamera,
			ballPos,
			renderer.isBallCamEnabled(),
		);
	}
}
