import type { BotDrive } from "../BotBehavior";
import {
	buildJumpGateContext,
	computePolicyMaturity,
	type JumpGateContext,
	type JumpHintContext,
	policySigmoid,
	resolveJumpDecision,
} from "./BotJumpResolver";

/** Parametry heurystyki modulowane przez wytrenowaną sieć. */
export type BotLearningTuning = {
	interceptLead: number;
	boostDistanceMul: number;
	challengeRadiusMul: number;
	aggression: number;
	boostBias: number;
	defenseBias: number;
	/** 0..1 — chęć lotu / aerial (uczy się z nagród za dotknięcia w powietrzu). */
	aerialBias: number;
};

export const NEUTRAL_TUNING: BotLearningTuning = {
	interceptLead: 1,
	boostDistanceMul: 1,
	challengeRadiusMul: 1,
	aggression: 1,
	boostBias: 0,
	defenseBias: 0,
	aerialBias: 0.35,
};

/** Sieć uczy się parametrów taktyki — nie zastępuje skoku / recovery heurystyki. */
export function deriveTuning(
	outputs: Float32Array,
	generation: number,
	fitness: number,
	active: boolean,
): BotLearningTuning {
	if (!active) {
		return NEUTRAL_TUNING;
	}

	const maturity = computePolicyMaturity(generation, fitness, active);

	return {
		interceptLead: clamp(0.86 + outputs[0]! * 0.44 * maturity, 0.7, 1.52),
		challengeRadiusMul: clamp(0.82 + outputs[1]! * 0.4 * maturity, 0.6, 1.5),
		boostDistanceMul: clamp(0.72 + outputs[2]! * 0.48 * maturity, 0.5, 1.45),
		aggression: clamp(
			0.72 + outputs[0]! * 0.45 * maturity + generation * 0.008,
			0.52,
			1.72,
		),
		boostBias: outputs[2]! * maturity,
		defenseBias: outputs[3]! * maturity,
		aerialBias: clamp(
			0.32 +
				outputs[1]! * 0.28 * maturity +
				Math.max(0, outputs[3]!) * 0.22 * maturity +
				generation * 0.012,
			0.22,
			0.96,
		),
	};
}

export type LearnedDriveContext = {
	policyOutputs: Float32Array;
	tuning: BotLearningTuning;
	maturity: number;
	jumpGate: JumpGateContext;
	heuristicJump: boolean;
};

/** Sterowanie + skok/boost modulowane przez politykę i kontekst sytuacji. */
export function resolveLearnedDrive(
	heuristic: BotDrive,
	ctx: LearnedDriveContext,
): BotDrive {
	const { policyOutputs, tuning, maturity, jumpGate, heuristicJump } = ctx;
	const jump = resolveJumpDecision(
		heuristicJump,
		policyOutputs[3]!,
		tuning,
		maturity,
		jumpGate,
	);

	const learnedBoost = policySigmoid(policyOutputs[2]!);
	const boostBlend = clamp(maturity * 0.75, 0.15, 0.85);
	const boostScore =
		(heuristic.boost ? 1 : 0) * (1 - boostBlend) + learnedBoost * boostBlend;

	const aerialBoost =
		tuning.aerialBias > 0.38 &&
		jumpGate.ballAirborne &&
		(jump || heuristic.boost) &&
		heuristic.forward !== 0;

	const boost =
		(boostScore > 0.52 && heuristic.forward !== 0) ||
		heuristic.boost ||
		aerialBoost;

	return {
		forward: heuristic.forward,
		yaw: heuristic.yaw,
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

function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}
