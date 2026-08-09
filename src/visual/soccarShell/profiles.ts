/**
 * SoccarShell — wspólne wymiary kieszeni bramki (fizyka = wizual).
 * Collision jest source of truth; dekor GLB tylko fit do tych AABB.
 */
import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";
import { GOAL_COVE_RUN } from "../perimeter/constants";

/** Promień głównej rury portalu (wizual + collidery). */
export const GOAL_TUBE_R = 0.38;

export const SOCCAR_GOAL = {
	tubeR: GOAL_TUBE_R,
	/** Half-extents cuboidów ≈ rura + mały pad (anti-tunnel). */
	postHalfX: GOAL_TUBE_R + 0.04,
	postHalfZ: GOAL_TUBE_R + 0.08,
	crossbarHalfY: GOAL_TUBE_R + 0.04,
	crossbarHalfZ: GOAL_TUBE_R + 0.06,
	backWallHalf: 0.18,
	sideWallHalfX: 0.2,
	ceilingHalfY: 0.1,
	/** Overlap murawy — bez progu na linii. */
	pocketLip: -0.35,
	mouthClear: 2.8,
	floorHalfY: 0.4,
	/** Zewnętrzny kołnierz (wizual mouthCollar) — blokuje wjazd w dekor. */
	collarOut: GOAL_TUBE_R * 1.05,
	collarR: GOAL_TUBE_R * 0.82,
	collarOuterOut: GOAL_TUBE_R * 1.55,
	collarOuterR: GOAL_TUBE_R * 0.55,
} as const;

export function goalCoveRun(): number {
	const { GOAL_DEPTH, GOAL_HEIGHT } = RL_ARENA;
	return Math.min(GOAL_COVE_RUN, GOAL_DEPTH * 0.22, GOAL_HEIGHT * 0.28);
}

export type GoalShellSide = "blue" | "orange";

export function goalLineZ(side: GoalShellSide): number {
	const zSign = side === "orange" ? 1 : -1;
	return zSign * RL_ARENA.HALF_LENGTH;
}

export function goalZSign(side: GoalShellSide): 1 | -1 {
	return side === "orange" ? 1 : -1;
}

/** Wewnętrzne wymiary kieszeni (powierzchnie rideable). */
export function goalInteriorBounds(side: GoalShellSide) {
	const { GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
	const zSign = goalZSign(side);
	const lineZ = goalLineZ(side);
	const cove = goalCoveRun();
	const halfW = GOAL_WIDTH / 2;
	const backInnerZ =
		lineZ + zSign * (GOAL_DEPTH - SOCCAR_GOAL.backWallHalf * 2);
	const mouthEndZ = lineZ + zSign * SOCCAR_GOAL.mouthClear;
	const ceilY = GOAL_HEIGHT - SOCCAR_GOAL.ceilingHalfY * 2;
	const floorY = PLAYFIELD_SURFACE_Y;
	const sideInnerX = halfW - SOCCAR_GOAL.sideWallHalfX * 2;

	return {
		zSign,
		lineZ,
		cove,
		halfW,
		backInnerZ,
		mouthEndZ,
		ceilY,
		floorY,
		sideInnerX,
		goalHeight: GOAL_HEIGHT,
		goalDepth: GOAL_DEPTH,
	};
}
