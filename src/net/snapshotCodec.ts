import * as THREE from "three";

import type GameObject from "../GameObject";
import type { CarEntity } from "../game/CarEntity";
import type { MatchController } from "../modes/MatchController";
import type { WorldSnapshotPayload } from "./protocol";

export function buildWorldSnapshot(
	tick: number,
	ball: GameObject,
	cars: CarEntity[],
	match: MatchController,
): WorldSnapshotPayload {
	const ballT = ball.rapierRigidBody.translation();
	const ballR = ball.rapierRigidBody.rotation();
	const ballLv = ball.rapierRigidBody.linvel();
	const ballAv = ball.rapierRigidBody.angvel();
	const hud = match.getHudSnapshot(cars);

	return {
		tick,
		serverTimeMs: performance.now(),
		ball: {
			pos: { x: ballT.x, y: ballT.y, z: ballT.z },
			quat: { x: ballR.x, y: ballR.y, z: ballR.z, w: ballR.w },
			linvel: { x: ballLv.x, y: ballLv.y, z: ballLv.z },
			angvel: { x: ballAv.x, y: ballAv.y, z: ballAv.z },
		},
		cars: cars.map((car) => {
			const t = car.player.rapierRigidBody.translation();
			const r = car.player.rapierRigidBody.rotation();
			const lv = car.player.rapierRigidBody.linvel();
			const av = car.player.rapierRigidBody.angvel();
			return {
				slot: car.slotIndex,
				pos: { x: t.x, y: t.y, z: t.z },
				quat: { x: r.x, y: r.y, z: r.z, w: r.w },
				linvel: { x: lv.x, y: lv.y, z: lv.z },
				angvel: { x: av.x, y: av.y, z: av.z },
				boost: car.player.getBoostFuel(),
				boosting: car.isBoosting(),
			};
		}),
		match: {
			phase: hud.phase,
			timeRemainingSec: hud.timeRemainingSec,
			blueScore: hud.blueScore,
			orangeScore: hud.orangeScore,
			countdownSec: hud.countdownSec,
			kickoffTick: hud.kickoffTick,
			kickoffIgnite: hud.kickoffIgnite,
			overtimeBanner: hud.overtimeBanner,
			isOvertime: hud.isOvertime,
			winnerLabel: hud.winnerLabel,
			replayActive: hud.replayActive,
			resetCountdown: hud.resetCountdown,
			goalScorerName: hud.goalScorerName,
		},
	};
}

export function applyWorldSnapshot(
	snapshot: WorldSnapshotPayload,
	ball: GameObject,
	cars: CarEntity[],
): void {
	const b = snapshot.ball;
	ball.rapierRigidBody.setTranslation(
		{ x: b.pos.x, y: b.pos.y, z: b.pos.z },
		true,
	);
	ball.rapierRigidBody.setRotation(
		{ x: b.quat.x, y: b.quat.y, z: b.quat.z, w: b.quat.w },
		true,
	);
	ball.rapierRigidBody.setLinvel(
		{ x: b.linvel.x, y: b.linvel.y, z: b.linvel.z },
		true,
	);
	ball.rapierRigidBody.setAngvel(
		{ x: b.angvel.x, y: b.angvel.y, z: b.angvel.z },
		true,
	);
	ball.syncWithRigidBody();

	for (const carSnap of snapshot.cars) {
		const car = cars.find((c) => c.slotIndex === carSnap.slot);
		if (!car) continue;
		const body = car.player.rapierRigidBody;
		body.setTranslation(
			{ x: carSnap.pos.x, y: carSnap.pos.y, z: carSnap.pos.z },
			true,
		);
		body.setRotation(
			{
				x: carSnap.quat.x,
				y: carSnap.quat.y,
				z: carSnap.quat.z,
				w: carSnap.quat.w,
			},
			true,
		);
		body.setLinvel(
			{ x: carSnap.linvel.x, y: carSnap.linvel.y, z: carSnap.linvel.z },
			true,
		);
		body.setAngvel(
			{ x: carSnap.angvel.x, y: carSnap.angvel.y, z: carSnap.angvel.z },
			true,
		);
		car.player.boostFuel = carSnap.boost;
		car.player.syncWithRigidBody();
	}
}

export function snapshotBallPosition(
	snapshot: WorldSnapshotPayload,
	out = new THREE.Vector3(),
): THREE.Vector3 {
	return out.set(snapshot.ball.pos.x, snapshot.ball.pos.y, snapshot.ball.pos.z);
}

export function snapshotBallVelocity(
	snapshot: WorldSnapshotPayload,
	out = new THREE.Vector3(),
): THREE.Vector3 {
	return out.set(
		snapshot.ball.linvel.x,
		snapshot.ball.linvel.y,
		snapshot.ball.linvel.z,
	);
}
