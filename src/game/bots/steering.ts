import * as THREE from "three";

import type Player from "../../util/Player";

export type BotDrive = {
	forward: number;
	yaw: number;
	boost: boolean;
	jump?: boolean;
};

const _fwd = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

/** Sterowanie w stylu RLBot — wektor napędu auta vs cel na płaszczyźnie XZ. */
export function steerToward(
	target: THREE.Vector3,
	player: Player,
	opts?: { boost?: boolean; arriveRadius?: number; reverseOk?: boolean },
): BotDrive {
	const arriveRadius = opts?.arriveRadius ?? 2.2;
	const carPos = player.getPosition();

	_fwd.copy(player.getForward());
	_fwd.y = 0;
	if (_fwd.lengthSq() < 1e-6) {
		_fwd.set(0, 0, 1);
	}
	_fwd.normalize();

	_toTarget.set(target.x - carPos.x, 0, target.z - carPos.z);
	const dist = _toTarget.length();
	if (dist < 0.05) {
		return { forward: 1, yaw: 0, boost: false };
	}
	_toTarget.multiplyScalar(1 / dist);

	const cross = _fwd.x * _toTarget.z - _fwd.z * _toTarget.x;
	const dot = _fwd.x * _toTarget.x + _fwd.z * _toTarget.z;

	const yaw = THREE.MathUtils.clamp(cross * 4.2, -1, 1);

	let forward = 1;
	if (dist < arriveRadius) {
		forward = 0.75;
	} else if (dot < 0.2) {
		forward = 0.85;
	} else if (dot < -0.2 && opts?.reverseOk) {
		forward = -0.7;
	}

	const boost =
		(opts?.boost ?? false) && dot > 0.82 && dist > 7 && Math.abs(yaw) < 0.45;

	return { forward, yaw, boost };
}

export function readCarYaw(player: Player): number {
	const rot = player.rapierRigidBody.rotation();
	const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
	const euler = new THREE.Euler().setFromQuaternion(q, "YXZ");
	return euler.y;
}
