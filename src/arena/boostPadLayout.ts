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

type PadUu = { readonly x: number; readonly z: number };

/**
 * Małe pady (12 boost) — 28 szt. Soccar / RLBot FieldInfo.
 * UU: x = szerokość, z = długość boiska (w RLBot: y).
 */
const RL_SMALL_PADS_UU: readonly PadUu[] = [
	{ x: 0, z: -4240 },
	{ x: -1792, z: -4184 },
	{ x: 1792, z: -4184 },
	{ x: -940, z: -3308 },
	{ x: 940, z: -3308 },
	{ x: 0, z: -2816 },
	{ x: -3584, z: -2484 },
	{ x: 3584, z: -2484 },
	{ x: -1788, z: -2302 },
	{ x: 1788, z: -2302 },
	{ x: -2048, z: -1036 },
	{ x: 2048, z: -1036 },
	{ x: 0, z: -1024 },
	{ x: -1024, z: 0 },
	{ x: 1024, z: 0 },
	{ x: 0, z: 1024 },
	{ x: -2048, z: 1036 },
	{ x: 2048, z: 1036 },
	{ x: -1788, z: 2302 },
	{ x: 1788, z: 2302 },
	{ x: -3584, z: 2484 },
	{ x: 3584, z: 2484 },
	{ x: 0, z: 2816 },
	{ x: -940, z: 3308 },
	{ x: 940, z: 3308 },
	{ x: -1792, z: 4184 },
	{ x: 1792, z: 4184 },
	{ x: 0, z: 4240 },
];

/**
 * Duże pady (100 boost) — 6 szt.: 4 narożniki + 2 side-mid.
 */
const RL_BIG_PADS_UU: readonly PadUu[] = [
	{ x: -3072, z: -4096 },
	{ x: 3072, z: -4096 },
	{ x: -3584, z: 0 },
	{ x: 3584, z: 0 },
	{ x: -3072, z: 4096 },
	{ x: 3072, z: 4096 },
];

/** Mały pad: +12%, szybki respawn. */
export const SMALL_BOOST_PAD = {
	amount: 0.12,
	radius: 1.35,
	respawnSec: 4,
} as const;

/** Duży pad: pełny tank, wolny respawn. */
export const BIG_BOOST_PAD = {
	amount: 1,
	radius: 2.55,
	respawnSec: 10,
} as const;

function rlPad(xUu: number, zUu: number, big: boolean): BoostPadSpec {
	const { sx, sz } = padScale();
	const stats = big ? BIG_BOOST_PAD : SMALL_BOOST_PAD;
	return {
		x: xUu * sx,
		z: zUu * sz,
		amount: stats.amount,
		radius: stats.radius,
		respawnSec: stats.respawnSec,
		big,
	};
}

/**
 * Kolejność jak RLBot FieldInfo (stabilne indeksy).
 * Źródło prawdy rozmiaru: RL_SMALL_PADS_UU / RL_BIG_PADS_UU.
 */
const RL_SOCCAR_ORDER_UU: readonly PadUu[] = [
	{ x: 0, z: -4240 },
	{ x: -1792, z: -4184 },
	{ x: 1792, z: -4184 },
	{ x: -3072, z: -4096 },
	{ x: 3072, z: -4096 },
	{ x: -940, z: -3308 },
	{ x: 940, z: -3308 },
	{ x: 0, z: -2816 },
	{ x: -3584, z: -2484 },
	{ x: 3584, z: -2484 },
	{ x: -1788, z: -2302 },
	{ x: 1788, z: -2302 },
	{ x: -2048, z: -1036 },
	{ x: 2048, z: -1036 },
	{ x: 0, z: -1024 },
	{ x: -3584, z: 0 },
	{ x: -1024, z: 0 },
	{ x: 1024, z: 0 },
	{ x: 3584, z: 0 },
	{ x: 0, z: 1024 },
	{ x: -2048, z: 1036 },
	{ x: 2048, z: 1036 },
	{ x: -1788, z: 2302 },
	{ x: 1788, z: 2302 },
	{ x: -3584, z: 2484 },
	{ x: 3584, z: 2484 },
	{ x: 0, z: 2816 },
	{ x: -940, z: 3308 },
	{ x: 940, z: 3308 },
	{ x: -3072, z: 4096 },
	{ x: 3072, z: 4096 },
	{ x: -1792, z: 4184 },
	{ x: 1792, z: 4184 },
	{ x: 0, z: 4240 },
];

const SMALL_PAD_KEYS = new Set(RL_SMALL_PADS_UU.map((p) => `${p.x},${p.z}`));
const BIG_PAD_KEYS = new Set(RL_BIG_PADS_UU.map((p) => `${p.x},${p.z}`));

if (
	SMALL_PAD_KEYS.size !== 28 ||
	BIG_PAD_KEYS.size !== 6 ||
	RL_SOCCAR_ORDER_UU.length !== 34 ||
	RL_SOCCAR_ORDER_UU.some(
		(p) =>
			SMALL_PAD_KEYS.has(`${p.x},${p.z}`) === BIG_PAD_KEYS.has(`${p.x},${p.z}`),
	)
) {
	throw new Error("boostPadLayout: niespójny podział small/big vs kolejność Soccar");
}

export function resolveBoostPadLayout(): BoostPadSpec[] {
	if (!ArenaRuntime.areBoostPadsEnabled()) return [];
	return buildBoostPadLayout();
}

export const buildBoostPadLayout = (): BoostPadSpec[] =>
	RL_SOCCAR_ORDER_UU.map((p) =>
		rlPad(p.x, p.z, BIG_PAD_KEYS.has(`${p.x},${p.z}`)),
	);

export function countBoostPadsBySize(pads: readonly BoostPadSpec[]): {
	small: number;
	big: number;
} {
	let small = 0;
	let big = 0;
	for (const p of pads) {
		if (p.big) big++;
		else small++;
	}
	return { small, big };
}
