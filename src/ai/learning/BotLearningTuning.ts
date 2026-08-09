import * as THREE from "three";

import type { BotDrive } from "../BotBehavior";
import {
	buildJumpGateContext,
	computePolicyMaturity,
	type JumpGateContext,
	type JumpHintContext,
	policySigmoid,
	resolveJumpDecision,
} from "./BotJumpResolver";

/** Parametry modulowane przez wytrenowaną sieć. */
export type BotLearningTuning = {
	interceptLead: number;
	boostDistanceMul: number;
	challengeRadiusMul: number;
	aggression: number;
	boostBias: number;
	defenseBias: number;
	aerialBias: number;
	targetLateral: number;
	targetLead: number;
	targetHeight: number;
	aerialHeightBias: number;
	strikeApproach: number;
	steerBlend: number;
	aerialSteerBlend: number;
	/** Bezpośredni cel względem piłki (m). */
	aimOffsetX: number;
	aimOffsetY: number;
	aimOffsetZ: number;
	/** 0..1 — jak mocno sieć nadpisuje heurystykę (cel + sterowanie). */
	policyAutonomy: number;
};

export const NEUTRAL_TUNING: BotLearningTuning = {
	interceptLead: 1,
	boostDistanceMul: 1,
	challengeRadiusMul: 1,
	aggression: 1,
	boostBias: 0,
	defenseBias: 0,
	aerialBias: 0.35,
	targetLateral: 0,
	targetLead: 0,
	targetHeight: 0,
	aerialHeightBias: 0,
	strikeApproach: 0,
	steerBlend: 0,
	aerialSteerBlend: 0,
	aimOffsetX: 0,
	aimOffsetY: 0,
	aimOffsetZ: 0,
	policyAutonomy: 0,
};

function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}

export function deriveTuning(
	outputs: Float32Array,
	generation: number,
	fitness: number,
	active: boolean,
): BotLearningTuning {
	if (!active) {
		return {
			...NEUTRAL_TUNING,
			policyAutonomy: 0.08,
			steerBlend: 0.12,
			aerialSteerBlend: 0.18,
		};
	}

	const maturity = computePolicyMaturity(generation, fitness, active);
	const o6 = outputs[6] ?? 0;
	const o7 = outputs[7] ?? 0;
	const o8 = outputs[8] ?? 0;
	const o9 = outputs[9] ?? 0;
	const o10 = outputs[10] ?? 0;
	const o11 = outputs[11] ?? 0;

	const autonomy = clamp(
		policySigmoid(o11) * 0.35 + maturity * 0.38,
		0.08,
		0.72,
	);

	return {
		interceptLead: clamp(0.86 + outputs[0]! * 0.52 * maturity, 0.65, 1.65),
		challengeRadiusMul: clamp(0.82 + outputs[1]! * 0.48 * maturity, 0.55, 1.65),
		boostDistanceMul: clamp(0.72 + outputs[2]! * 0.55 * maturity, 0.45, 1.55),
		aggression: clamp(
			0.72 + outputs[0]! * 0.5 * maturity + Math.log1p(generation) * 0.02,
			0.5,
			1.85,
		),
		boostBias: outputs[2]! * maturity,
		defenseBias: outputs[3]! * maturity,
		aerialBias: clamp(
			0.3 +
				outputs[1]! * 0.32 * maturity +
				Math.max(0, outputs[3]!) * 0.26 * maturity +
				Math.log1p(generation) * 0.018,
			0.2,
			0.98,
		),
		targetLateral: o6 * 14 * maturity,
		targetLead: o7 * 11 * maturity,
		targetHeight: o7 * 1.2 * maturity,
		aerialHeightBias: o7 * 3.2 * maturity,
		strikeApproach: clamp(o6 * 4.2 * maturity, -5, 5),
		steerBlend: clamp(0.15 + autonomy * 0.52, 0.15, 0.62),
		aerialSteerBlend: clamp(0.22 + autonomy * 0.48, 0.22, 0.72),
		aimOffsetX: o8 * 16 * autonomy,
		aimOffsetY: o10 * 5.5 * autonomy,
		aimOffsetZ: o9 * 16 * autonomy,
		policyAutonomy: autonomy,
	};
}

export type LearnedDriveContext = {
	policyOutputs: Float32Array;
	tuning: BotLearningTuning;
	maturity: number;
	jumpGate: JumpGateContext;
	heuristicJump: boolean;
};

function blendSteerAxis(
	heuristic: number,
	learned: number,
	blend: number,
): number {
	return heuristic * (1 - blend) + learned * blend;
}

export function resolveLearnedDrive(
	heuristic: BotDrive,
	ctx: LearnedDriveContext,
): BotDrive {
	const { policyOutputs, tuning, maturity, jumpGate, heuristicJump } = ctx;
	const authority = tuning.policyAutonomy;

	const jump = resolveJumpDecision(
		heuristicJump,
		policyOutputs[3]!,
		tuning,
		maturity,
		jumpGate,
		authority,
	);

	const learnedBoost = policySigmoid(policyOutputs[2]!);
	const boostBlend = clamp(0.25 + authority * 0.75, 0.25, 1);
	const boostScore =
		(heuristic.boost ? 1 : 0) * (1 - boostBlend) + learnedBoost * boostBlend;

	const aerialBoost =
		tuning.aerialBias > 0.32 &&
		jumpGate.ballAirborne &&
		(jump || learnedBoost > 0.55) &&
		authority > 0.35;

	const inAir = jumpGate.inAir;
	const steerBlend = clamp(
		inAir
			? Math.max(tuning.aerialSteerBlend, authority * 0.72)
			: Math.max(tuning.steerBlend, authority * 0.68),
		0,
		0.72,
	);

	const learnedFwd = THREE.MathUtils.clamp(policyOutputs[4] ?? 0, -1, 1);
	const learnedYaw = THREE.MathUtils.clamp(policyOutputs[5] ?? 0, -1, 1);

	const hFwd =
		heuristic.forwardAxis ??
		(heuristic.forward > 0 ? 1 : heuristic.forward < 0 ? -1 : 0);
	const hYaw =
		heuristic.yawAxis ?? (heuristic.yaw > 0 ? 1 : heuristic.yaw < 0 ? -1 : 0);

	const fwdAxis = blendSteerAxis(hFwd, learnedFwd, steerBlend);
	const yawAxis = blendSteerAxis(hYaw, learnedYaw, steerBlend);

	let boost = boostScore > 0.48 || aerialBoost;
	if (authority > 0.55) {
		boost =
			learnedBoost > 0.42 ||
			aerialBoost ||
			(heuristic.boost && boostScore > 0.35);
	}
	if (authority > 0.72 && inAir && jumpGate.ballAirborne) {
		boost = learnedBoost > 0.35 || boost;
	}
	if (
		!inAir &&
		Math.abs(yawAxis) > 0.78 &&
		Math.abs(fwdAxis) < 0.18 &&
		!heuristic.boost
	) {
		boost = false;
	}
	if (
		!inAir &&
		Math.abs(fwdAxis) < 0.06 &&
		authority > 0.55 &&
		!heuristic.boost &&
		!aerialBoost
	) {
		boost = false;
	}

	let forward = 0;
	if (fwdAxis > 0.1) forward = 1;
	else if (fwdAxis < -0.1) forward = -1;

	let yaw = 0;
	if (yawAxis > 0.1) yaw = 1;
	else if (yawAxis < -0.1) yaw = -1;

	return {
		forward,
		yaw,
		forwardAxis: fwdAxis,
		yawAxis,
		boost,
		jump,
	};
}

export function buildLearnedDriveContext(
	player: import("../../util/Player").default,
	hint: JumpHintContext,
	policyOutputs: Float32Array,
	generation: number,
	fitness: number,
	active: boolean,
): LearnedDriveContext {
	const tuning = deriveTuning(policyOutputs, generation, fitness, active);
	const maturity = computePolicyMaturity(generation, fitness, active);
	return {
		policyOutputs,
		tuning,
		maturity,
		jumpGate: buildJumpGateContext(player, hint),
		heuristicJump: hint.heuristicJump,
	};
}
