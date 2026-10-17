/**
 * Demolish gameplay — RL Soccar rules (uproszczone).
 * SS + nose toward victim → explode → 3 s → respawn 33 boost.
 */
import * as THREE from "three";

import type Player from "../util/Player";
import { SUPERSONIC_MPS } from "../visual/supersonicBreak";

export const DEMO_RESPAWN_SEC = 3;
/** Pro Demo Transition Time default 0.75 — lot kamery death→spawn. */
export const DEMO_CAM_TRANSITION_SEC = 0.55;
/** Krótka niewrażliwość po respawnie. */
export const DEMO_SPAWN_INVULN_SEC = 0.85;
/** SS buffer (~2100 uu / 2200). */
const DEMO_SPEED_MIN = SUPERSONIC_MPS * 0.95;
const DEMO_FWD_SPEED_MIN = SUPERSONIC_MPS * 0.9;
/** ~40° od nosa (cos 40° ≈ 0.766). */
const DEMO_NOSE_DOT_MIN = 0.72;

const _fwd = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _to = new THREE.Vector3();

export function evaluateDemolish(
	attacker: Player,
	victim: Player,
	opts?: { sameTeam?: boolean; friendlyFire?: boolean },
): boolean {
	if (attacker.isDemolished() || victim.isDemolished()) return false;
	if (victim.isDemoInvulnerable()) return false;
	if (opts?.sameTeam && !opts.friendlyFire) return false;

	_vel.copy(attacker.getVelocity());
	const speed = _vel.length();
	if (speed < DEMO_SPEED_MIN) return false;

	_fwd.copy(attacker.getForward());
	if (_fwd.lengthSq() < 1e-8) return false;
	_fwd.normalize();
	const fwdSpeed = Math.max(0, _fwd.dot(_vel));
	if (fwdSpeed < DEMO_FWD_SPEED_MIN) return false;

	_to.copy(victim.getPosition()).sub(attacker.getPosition());
	if (_to.lengthSq() < 1e-6) return true;
	_to.normalize();
	return _fwd.dot(_to) >= DEMO_NOSE_DOT_MIN;
}
