import type * as THREE from "three";
import type Player from "../../util/Player";
import { isBallAirborne, isLooseBall } from "../botTactics";
import type { BotLearningTuning } from "./BotLearningTuning";

export type JumpHintContext = {
	ballPos: THREE.Vector3;
	ballVel: THREE.Vector3;
	heuristicJump: boolean;
	forceRecovery: boolean;
	forcedJump: boolean;
	defending: boolean;
	clearanceActive: boolean;
	goalie: boolean;
};

export type JumpGateContext = {
	forceRecovery: boolean;
	forcedJump: boolean;
	inAir: boolean;
	onGround: boolean;
	ballAirborne: boolean;
	ballAboveBot: boolean;
	ballY: number;
	horizDist: number;
	defending: boolean;
	looseBall: boolean;
	goalieOrClearance: boolean;
};

function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}

export function policySigmoid(x: number): number {
	return 1 / (1 + Math.exp(-x));
}

/** Im wyższa generacja/fitness, tym więcej decyduje wytrenowana polityka. */
export function computePolicyMaturity(
	generation: number,
	fitness: number,
	active: boolean,
): number {
	if (!active) return 0.12;
	return clamp(
		0.15 + Math.log1p(generation) * 0.11 + Math.max(0, fitness) * 0.006,
		0.15,
		0.88,
	);
}

export function buildJumpGateContext(
	player: Player,
	hint: JumpHintContext,
): JumpGateContext {
	const pos = player.getPosition();
	const horizDist = Math.hypot(hint.ballPos.x - pos.x, hint.ballPos.z - pos.z);
	const defending = hint.defending || hint.clearanceActive || hint.goalie;
	const looseBall = isLooseBall(hint.ballVel);
	const minAirY = defending ? 1.4 : 1.55;

	return {
		forceRecovery: hint.forceRecovery,
		forcedJump: hint.forcedJump,
		inAir: !player.isOnGround(),
		onGround: player.isOnGround(),
		ballAirborne: isBallAirborne(hint.ballPos, hint.ballVel, minAirY),
		ballAboveBot: hint.ballPos.y > pos.y + 0.2,
		ballY: hint.ballPos.y,
		horizDist,
		defending,
		looseBall,
		goalieOrClearance: hint.goalie || hint.clearanceActive,
	};
}

/** Kiedy skok ma sens — przy wysokiej autonomii sieć ma szerszy zakres. */
export function isJumpSituationAllowed(
	ctx: JumpGateContext,
	policyAutonomy = 0,
): boolean {
	if (ctx.forceRecovery || ctx.forcedJump) return true;

	const reach = 7.5 + policyAutonomy * 6;
	const airReach = 12 + policyAutonomy * 8;

	if (ctx.inAir) {
		return (
			ctx.ballAirborne &&
			ctx.ballAboveBot &&
			ctx.horizDist < reach &&
			ctx.ballY > 1.05 - policyAutonomy * 0.15
		);
	}

	if (ctx.looseBall && !ctx.ballAirborne && policyAutonomy < 0.55) {
		return false;
	}
	if (ctx.defending) {
		return (
			ctx.ballAirborne ||
			ctx.ballY > 1.05 ||
			ctx.horizDist < 3.4 + policyAutonomy * 2.5
		);
	}
	return ctx.ballAirborne && ctx.horizDist < airReach;
}

/**
 * Heurystyka + wyjście sieci (outputs[3]) → decyzja skoku.
 * Z czasem polityka przejmuje, ale fizyczna bramka zawsze obowiązuje.
 */
export function resolveJumpDecision(
	heuristicJump: boolean,
	jumpRaw: number,
	tuning: BotLearningTuning,
	maturity: number,
	ctx: JumpGateContext,
	policyAutonomy = 0,
): boolean {
	if (ctx.forceRecovery || ctx.forcedJump) return true;
	if (!isJumpSituationAllowed(ctx, policyAutonomy)) return false;

	const learned = policySigmoid(jumpRaw);
	const heuristic = heuristicJump ? 1 : 0;
	const blend = clamp(
		0.18 + Math.max(maturity, policyAutonomy) * 0.55,
		0.18,
		0.85,
	);
	const score = heuristic * (1 - blend) + learned * blend;

	const threshold = clamp(
		0.68 -
			tuning.aerialBias * 0.3 -
			policyAutonomy * 0.22 -
			maturity * 0.12 +
			(ctx.defending ? 0.05 : 0),
		0.28,
		0.76,
	);

	if (policyAutonomy > 0.62 && learned > 0.4 && ctx.ballAirborne) {
		return true;
	}
	if (maturity < 0.38 && policyAutonomy < 0.45) {
		return heuristicJump && score >= threshold * 0.9;
	}
	return score >= threshold;
}
