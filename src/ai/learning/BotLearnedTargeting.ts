import * as THREE from "three";

import type { BotFsmState } from "../BotBehavior";
import { isBallAirborne } from "../botTactics";
import type { BotLearningTuning } from "./BotLearningTuning";

const _shot = new THREE.Vector3();
const _lateral = new THREE.Vector3();
const _velDir = new THREE.Vector3();
const _toBall = new THREE.Vector3();
const _aim = new THREE.Vector3();

export type LearnedTargetContext = {
	ballPos: THREE.Vector3;
	ballVel: THREE.Vector3;
	botPos: THREE.Vector3;
	enemyGoal: THREE.Vector3;
	fsmState: BotFsmState;
};

/**
 * Sieć przesuwa lub zastępuje heurystyczny cel jazdy — ustawienie pod strzał / aerial.
 */
export function applyLearnedTargetOffset(
	target: THREE.Vector3,
	ctx: LearnedTargetContext,
	tuning: BotLearningTuning,
): void {
	const authority = tuning.policyAutonomy;
	if (
		authority < 0.2 &&
		tuning.steerBlend < 0.2 &&
		Math.abs(tuning.targetLateral) < 0.15
	) {
		return;
	}

	const airborne = isBallAirborne(ctx.ballPos, ctx.ballVel, 1.45);
	const aerialMode = ctx.fsmState === "AERIAL" || airborne;

	if (authority > 0.22) {
		_aim.copy(ctx.ballPos);
		_aim.x += tuning.aimOffsetX;
		_aim.y += Math.max(0.15, tuning.aimOffsetY);
		_aim.z += tuning.aimOffsetZ;
		if (aerialMode) {
			_aim.y = Math.max(_aim.y, ctx.ballPos.y - 0.35);
		}
		target.lerp(_aim, clampAutonomyBlend(authority, aerialMode));
	}

	_shot.subVectors(ctx.enemyGoal, ctx.ballPos);
	_shot.y = 0;
	if (_shot.lengthSq() > 0.01) {
		_shot.normalize();
		_lateral.set(-_shot.z, 0, _shot.x);
		target.addScaledVector(_lateral, tuning.targetLateral);
	}

	if (ctx.ballVel.lengthSq() > 0.35) {
		_velDir.copy(ctx.ballVel);
		_velDir.y *= 0.35;
		if (_velDir.lengthSq() > 0.01) {
			_velDir.normalize();
			target.addScaledVector(_velDir, tuning.targetLead);
		}
	}

	if (aerialMode) {
		const strikeY =
			ctx.ballPos.y -
			0.55 +
			tuning.aerialHeightBias +
			(airborne ? tuning.targetHeight : 0);
		target.y = Math.max(target.y, strikeY);

		_toBall.subVectors(ctx.ballPos, ctx.botPos);
		_toBall.y = 0;
		const horiz = _toBall.length();
		if (horiz > 0.4 && horiz < 18) {
			_toBall.multiplyScalar(1 / horiz);
			target.addScaledVector(_toBall, -tuning.strikeApproach);
		}
	} else if (Math.abs(tuning.targetHeight) > 0.05) {
		target.y = Math.max(0, target.y + tuning.targetHeight);
	}
}

function clampAutonomyBlend(authority: number, aerial: boolean): number {
	const base = aerial ? 0.55 : 0.42;
	return Math.min(1, base + authority * (aerial ? 0.45 : 0.52));
}
