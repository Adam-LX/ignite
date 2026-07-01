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
	if (!active) return 0.28;
	return clamp(
		0.32 + generation * 0.048 + Math.max(0, fitness) * 0.0075,
		0.32,
		0.94,
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

/** Twarda logika fizyczna — kiedy skok w ogóle ma sens. */
export function isJumpSituationAllowed(ctx: JumpGateContext): boolean {
	if (ctx.forceRecovery || ctx.forcedJump) return true;

	if (ctx.inAir) {
		return (
			ctx.ballAirborne &&
			ctx.ballAboveBot &&
			ctx.horizDist < 7.5 &&
			ctx.ballY > 1.15
		);
	}

	if (ctx.looseBall && !ctx.ballAirborne) return false;
	if (ctx.defending) {
		return ctx.ballAirborne || ctx.ballY > 1.05 || ctx.horizDist < 3.4;
	}
	return ctx.ballAirborne && ctx.horizDist < 12;
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
): boolean {
	if (ctx.forceRecovery || ctx.forcedJump) return true;
	if (!isJumpSituationAllowed(ctx)) return false;

	const learned = policySigmoid(jumpRaw);
	const heuristic = heuristicJump ? 1 : 0;
	const blend = clamp(maturity * 0.9, 0.18, 0.92);
	const score = heuristic * (1 - blend) + learned * blend;

	const threshold = clamp(
		0.7 -
			tuning.aerialBias * 0.26 -
			maturity * 0.1 +
			(ctx.defending ? 0.06 : 0),
		0.36,
		0.78,
	);

	if (maturity < 0.42) {
		return heuristicJump && score >= threshold * 0.92;
	}
	return score >= threshold;
}
