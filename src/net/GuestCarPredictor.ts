import * as THREE from "three";

import type { CarEntity } from "../game/CarEntity";
import { NETCODE } from "./netcodeTuning";
import type { CarSnapshotPayload } from "./protocol";

/** Client-side prediction + reconciliacja auta gościa względem hosta. */
export class GuestCarPredictor {
	private readonly error = new THREE.Vector3();
	private authority: CarSnapshotPayload | null = null;

	reset(): void {
		this.error.set(0, 0, 0);
		this.authority = null;
	}

	ingestAuthority(snap: CarSnapshotPayload, car: CarEntity): void {
		const pos = car.player.getPosition();
		if (this.authority) {
			this.error.set(
				pos.x - snap.pos.x,
				pos.y - snap.pos.y,
				pos.z - snap.pos.z,
			);
			const dist = this.error.length();
			if (dist > NETCODE.RECONCILE_SNAP_DIST_M) {
				this.error.multiplyScalar(0);
				this.applySnapshotToCar(snap, car);
			}
		} else {
			this.applySnapshotToCar(snap, car);
		}
		this.authority = snap;
	}

	reconcile(car: CarEntity, dt: number): void {
		if (this.error.lengthSq() < 1e-6) return;

		const pull = 1 - Math.exp(-NETCODE.RECONCILE_RATE * dt);
		const body = car.player.rapierRigidBody;
		const t = body.translation();
		body.setTranslation(
			{
				x: t.x - this.error.x * pull,
				y: t.y - this.error.y * pull,
				z: t.z - this.error.z * pull,
			},
			true,
		);
		this.error.multiplyScalar(1 - pull);
		car.player.syncWithRigidBody();
	}

	applyAuthority(car: CarEntity): void {
		if (!this.authority) return;
		this.applySnapshotToCar(this.authority, car);
		this.error.set(0, 0, 0);
	}

	private applySnapshotToCar(snap: CarSnapshotPayload, car: CarEntity): void {
		const body = car.player.rapierRigidBody;
		body.setTranslation({ x: snap.pos.x, y: snap.pos.y, z: snap.pos.z }, true);
		body.setRotation(
			{ x: snap.quat.x, y: snap.quat.y, z: snap.quat.z, w: snap.quat.w },
			true,
		);
		body.setLinvel(
			{ x: snap.linvel.x, y: snap.linvel.y, z: snap.linvel.z },
			true,
		);
		body.setAngvel(
			{ x: snap.angvel.x, y: snap.angvel.y, z: snap.angvel.z },
			true,
		);
		car.player.boostFuel = snap.boost;
		car.player.syncWithRigidBody();
	}
}

export function guestPredictionActive(match: {
	phase: string;
	kickoffTick: number | null;
	kickoffIgnite: boolean;
	replayActive: boolean;
}): boolean {
	if (match.replayActive) return false;
	if (match.kickoffTick !== null || match.kickoffIgnite) return false;
	return match.phase === "playing" || match.phase === "goal_bounce";
}
