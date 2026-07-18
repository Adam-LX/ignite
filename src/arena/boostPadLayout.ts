import { ArenaRuntime } from "../arena/ArenaRuntime";
import { RL_ARENA } from "../visual/arenaConstants";

function padScale(): { sx: number; sz: number } {
	const scale = ArenaRuntime.getSpawnScale();
	return {
		sx: (RL_ARENA.HALF_WIDTH / 4096) * scale,
		sz: (RL_ARENA.HALF_LENGTH / 5120) * scale,
	};
}

export type BoostPadSpec = {
	x: number;
	z: number;
	/** Dodatek do boostFuel 0–1. */
	amount: number;
	radius: number;
	respawnSec: number;
	big: boolean;
};

function rlPad(xUu: number, zUu: number, big: boolean): BoostPadSpec {
	const { sx, sz } = padScale();
	return {
		x: xUu * sx,
		z: zUu * sz,
		amount: big ? 1 : 0.12,
		radius: big ? 2.35 : 1.55,
		respawnSec: big ? 10 : 4,
		big,
	};
}

/** Symetryczne pady Soccar — 6 big (4 narożniki + 2 mid), reszta small. */
function halfPads(sign: 1 | -1): BoostPadSpec[] {
	return [
		rlPad(0, sign * 4240, false),
		rlPad(-3072, sign * 4096, true),
		rlPad(3072, sign * 4096, true),
		rlPad(-3584, sign * 2484, false),
		rlPad(3584, sign * 2484, false),
		rlPad(-2048, sign * 1036, false),
		rlPad(2048, sign * 1036, false),
		rlPad(-1024, sign * 2304, false),
		rlPad(1024, sign * 2304, false),
	];
}

export function resolveBoostPadLayout(): BoostPadSpec[] {
	if (!ArenaRuntime.areBoostPadsEnabled()) return [];
	return buildBoostPadLayout();
}

export const buildBoostPadLayout = (): BoostPadSpec[] => [
	...halfPads(-1),
	...halfPads(1),
	rlPad(-3584, 0, true),
	rlPad(3584, 0, true),
];
