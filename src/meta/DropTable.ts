import { ArenaRuntime } from "../arena/ArenaRuntime";
import type { GameModeId } from "../game/modes";
import {
	ALL_COSMETIC_KINDS,
	getDropRules,
	getDroppableCosmeticIds,
	getCosmeticRarity,
	getPaintRules,
	isPaintableKind,
	makeCosmeticRef,
	type CosmeticKind,
	type CosmeticRef,
	type CosmeticRarity,
	type ItemProvenance,
} from "./CosmeticCatalog";
import { getAllPaintIds, getPaintRarity, type PaintRarity } from "./PaintCatalog";
import {
	incrementMatchesSinceDrop,
	isInstanceUnlocked,
	resetMatchesSinceDrop,
	unlockInstance,
	getMatchesSinceDrop,
} from "./PlayerInventory";

export interface DropRollContext {
	won: boolean;
	blueScore: number;
	orangeScore: number;
	modeId: GameModeId;
	online: boolean;
	ranked: boolean;
}

export type DropResult =
	| { kind: "crate"; items: CosmeticRef[] }
	| {
			kind: "none";
			reason: "ranked" | "all_unlocked" | "no_roll" | "duplicate";
	  };

const RARITY_ORDER: CosmeticRarity[] = [
	"common",
	"rare",
	"epic",
	"legendary",
];

const PAINT_RARITY_ORDER: PaintRarity[] = [
	"common",
	"uncommon",
	"rare",
	"veryRare",
	"legendary",
];

export function computeDropChance(ctx: DropRollContext): number {
	const rules = getDropRules();
	let chance = rules.baseChance;
	if (ctx.won) chance += rules.winBonus;
	const cap = rules.maxDropChance ?? 0.95;
	return Math.min(cap, chance);
}

export function computeRollAttempts(
	ctx: DropRollContext,
	rng: () => number = Math.random,
): number {
	const rules = getDropRules();
	let attempts = rules.minRollsPerMatch ?? 1;
	if (ctx.won) {
		attempts += rules.bonusRollsOnWin ?? 0;
		if (Math.abs(ctx.blueScore - ctx.orangeScore) >= 3) {
			attempts += rules.bonusRollsOnBlowout ?? 0;
		}
	} else if (rng() < (rules.bonusRollChanceOnLoss ?? 0)) {
		attempts += 1;
	}
	return Math.max(1, attempts);
}

function hasUnlockableInstanceForItem(
	kind: CosmeticKind,
	itemId: string,
): boolean {
	if (!isInstanceUnlocked(makeCosmeticRef(kind, itemId, null))) return true;
	if (!isPaintableKind(kind)) return false;
	for (const paintId of getAllPaintIds()) {
		if (!isInstanceUnlocked(makeCosmeticRef(kind, itemId, paintId))) {
			return true;
		}
	}
	return false;
}

export function hasLockedDrops(): boolean {
	for (const kind of ALL_COSMETIC_KINDS) {
		for (const itemId of getDroppableCosmeticIds(kind)) {
			if (hasUnlockableInstanceForItem(kind, itemId)) return true;
		}
	}
	return false;
}

function pickCategory(rng: () => number): CosmeticKind | null {
	const rules = getDropRules();
	const weights = rules.categoryWeights;
	const entries = ALL_COSMETIC_KINDS.map((kind) => ({
		kind,
		weight: weights[kind] ?? 0,
	})).filter((e) => {
		const hasPool = getDroppableCosmeticIds(e.kind).some((itemId) =>
			hasUnlockableInstanceForItem(e.kind, itemId),
		);
		return hasPool && e.weight > 0;
	});
	if (entries.length === 0) return null;
	const total = entries.reduce((s, e) => s + e.weight, 0);
	let roll = rng() * total;
	for (const e of entries) {
		roll -= e.weight;
		if (roll <= 0) return e.kind;
	}
	return entries[entries.length - 1]!.kind;
}

function pickRarity(
	rng: () => number,
	minRarity?: CosmeticRarity,
): CosmeticRarity {
	const weights = getDropRules().rarityWeights;
	const minIdx = minRarity ? RARITY_ORDER.indexOf(minRarity) : 0;
	const entries = RARITY_ORDER.map((r) => ({
		r,
		weight: r === minRarity ? weights[r]! * 2 : (weights[r] ?? 0),
	})).filter((e) => RARITY_ORDER.indexOf(e.r) >= minIdx);
	const total = entries.reduce((s, e) => s + e.weight, 0);
	let roll = rng() * total;
	for (const e of entries) {
		roll -= e.weight;
		if (roll <= 0) return e.r;
	}
	return entries[entries.length - 1]!.r;
}

function pickPaintRarity(
	rng: () => number,
	minRarity?: PaintRarity,
): PaintRarity {
	const weights = getPaintRules().rarityWeights;
	const minIdx = minRarity ? PAINT_RARITY_ORDER.indexOf(minRarity) : 0;
	const entries = PAINT_RARITY_ORDER.map((r) => ({
		r,
		weight: r === minRarity ? weights[r]! * 2 : (weights[r] ?? 0),
	})).filter((e) => PAINT_RARITY_ORDER.indexOf(e.r) >= minIdx);
	const total = entries.reduce((s, e) => s + e.weight, 0);
	let roll = rng() * total;
	for (const e of entries) {
		roll -= e.weight;
		if (roll <= 0) return e.r;
	}
	return entries[entries.length - 1]!.r;
}

function itemsInTier(
	kind: CosmeticKind,
	tier: CosmeticRarity,
): string[] {
	return getDroppableCosmeticIds(kind).filter((itemId) => {
		const ref = makeCosmeticRef(kind, itemId, null);
		return (
			getCosmeticRarity(ref) === tier &&
			hasUnlockableInstanceForItem(kind, itemId)
		);
	});
}

function pickItemFromCategory(
	kind: CosmeticKind,
	rng: () => number,
	minRarity?: CosmeticRarity,
): string | null {
	let tier = pickRarity(rng, minRarity);
	let tierIdx = RARITY_ORDER.indexOf(tier);

	for (let i = tierIdx; i < RARITY_ORDER.length; i++) {
		const pool = itemsInTier(kind, RARITY_ORDER[i]!);
		if (pool.length > 0) {
			return pool[Math.floor(rng() * pool.length)]!;
		}
	}

	for (let i = tierIdx - 1; i >= 0; i--) {
		const pool = itemsInTier(kind, RARITY_ORDER[i]!);
		if (pool.length > 0) {
			return pool[Math.floor(rng() * pool.length)]!;
		}
	}

	const fallback = getDroppableCosmeticIds(kind).filter((itemId) =>
		hasUnlockableInstanceForItem(kind, itemId),
	);
	if (fallback.length === 0) return null;
	return fallback[Math.floor(rng() * fallback.length)]!;
}

function rollPaintId(
	rng: () => number,
	minPaintRarity?: PaintRarity,
): string | null {
	const rules = getPaintRules();
	if (rng() >= rules.paintedChance) return null;

	const tier = pickPaintRarity(rng, minPaintRarity);
	const tierIdx = PAINT_RARITY_ORDER.indexOf(tier);
	const paints = getAllPaintIds();

	for (let i = tierIdx; i < PAINT_RARITY_ORDER.length; i++) {
		const pool = paints.filter(
			(id) => getPaintRarity(id) === PAINT_RARITY_ORDER[i],
		);
		if (pool.length > 0) {
			return pool[Math.floor(rng() * pool.length)]!;
		}
	}
	for (let i = tierIdx - 1; i >= 0; i--) {
		const pool = paints.filter(
			(id) => getPaintRarity(id) === PAINT_RARITY_ORDER[i],
		);
		if (pool.length > 0) {
			return pool[Math.floor(rng() * pool.length)]!;
		}
	}
	return paints[Math.floor(rng() * paints.length)] ?? null;
}

function buildDropInstance(
	kind: CosmeticKind,
	itemId: string,
	rng: () => number,
	forcePainted = false,
	minPaintRarity?: PaintRarity,
): CosmeticRef {
	let paintId: string | null = null;
	if (isPaintableKind(kind)) {
		if (forcePainted) {
			paintId = rollPaintId(rng, minPaintRarity);
			if (paintId === null) {
				const paints = getAllPaintIds().filter((id) => {
					if (!minPaintRarity) return true;
					return (
						PAINT_RARITY_ORDER.indexOf(getPaintRarity(id)) >=
						PAINT_RARITY_ORDER.indexOf(minPaintRarity)
					);
				});
				paintId = paints[Math.floor(rng() * paints.length)] ?? null;
			}
		} else {
			paintId = rollPaintId(rng);
		}
	}

	if (
		paintId &&
		isInstanceUnlocked(makeCosmeticRef(kind, itemId, paintId))
	) {
		if (!isInstanceUnlocked(makeCosmeticRef(kind, itemId, null))) {
			paintId = null;
		} else {
			const unpaintedFree = !isInstanceUnlocked(
				makeCosmeticRef(kind, itemId, null),
			);
			paintId = unpaintedFree ? null : paintId;
		}
	}

	if (
		paintId === null &&
		isInstanceUnlocked(makeCosmeticRef(kind, itemId, null))
	) {
		if (isPaintableKind(kind)) {
			const freePaint = getAllPaintIds().find(
				(id) =>
					!isInstanceUnlocked(makeCosmeticRef(kind, itemId, id)),
			);
			paintId = freePaint ?? null;
		}
	}

	return makeCosmeticRef(kind, itemId, paintId);
}

export function rollCrateItem(
	rng: () => number,
	forcePity = false,
): CosmeticRef | null {
	const rules = getDropRules();
	const minRarity = forcePity ? rules.pityRules.guaranteedRarity : undefined;
	const minPaintRarity: PaintRarity | undefined = forcePity ? "rare" : undefined;

	for (let attempt = 0; attempt < rules.duplicateRerollMax + 1; attempt++) {
		const kind = pickCategory(rng);
		if (!kind) return null;

		const itemId = pickItemFromCategory(kind, rng, minRarity);
		if (!itemId) continue;

		const forcePaint =
			forcePity &&
			isPaintableKind(kind) &&
			isInstanceUnlocked(makeCosmeticRef(kind, itemId, null)) &&
			getCosmeticRarity(makeCosmeticRef(kind, itemId, null)) === minRarity;

		const item = buildDropInstance(
			kind,
			itemId,
			rng,
			forcePaint,
			minPaintRarity,
		);

		if (!isInstanceUnlocked(item)) return item;
	}
	return null;
}

/** Losuje drop po meczu (offline + casual online). */
export function rollMatchDrop(
	ctx: DropRollContext,
	rng: () => number = Math.random,
): DropResult {
	if (ctx.ranked) {
		incrementMatchesSinceDrop();
		return { kind: "none", reason: "ranked" };
	}

	if (!hasLockedDrops()) {
		incrementMatchesSinceDrop();
		return { kind: "none", reason: "all_unlocked" };
	}

	const rules = getDropRules();
	const pity = getMatchesSinceDrop();
	const forcePity = pity + 1 >= rules.pityRules.matchesThreshold;
	const chance = computeDropChance(ctx);
	const rolled = forcePity || rng() < chance;

	incrementMatchesSinceDrop();

	if (!rolled) {
		return { kind: "none", reason: "no_roll" };
	}

	const attempts = computeRollAttempts(ctx, rng);
	const items: CosmeticRef[] = [];
	const seenKeys = new Set<string>();

	for (let i = 0; i < attempts; i++) {
		const item = rollCrateItem(rng, forcePity && i === 0);
		if (!item || isInstanceUnlocked(item)) continue;
		const key = `${item.kind}:${item.itemId}:${item.paintId ?? ""}`;
		if (seenKeys.has(key)) continue;
		const provenance: ItemProvenance = {
			source: "match_drop",
			arenaId: ArenaRuntime.getId(),
			unlockedAt: Date.now(),
		};
		unlockInstance(item, true, provenance);
		seenKeys.add(key);
		items.push(item);
	}

	if (items.length === 0) {
		return { kind: "none", reason: "duplicate" };
	}

	if (rules.pityRules.pityResetOnDrop) {
		resetMatchesSinceDrop();
	}
	return { kind: "crate", items };
}

export function shouldRollDrops(
	payload: Pick<DropRollContext, "ranked" | "modeId">,
): boolean {
	if (payload.ranked) return false;
	if (payload.modeId === "ignition") return false;
	return true;
}

/** @deprecated — test compat */
export function pickLockedCarId(rng: () => number): string | null {
	const pool = getDroppableCosmeticIds("car").filter(
		(id) => !isInstanceUnlocked(makeCosmeticRef("car", id, null)),
	);
	if (pool.length === 0) return null;
	return pool[Math.floor(rng() * pool.length)] ?? null;
}

/** @deprecated — test compat */
export function pickLockedDrop(
	rng: () => number,
): { kind: "car" | "arena"; id: string } | null {
	const kind = rng() < 0.5 ? "car" : "arena";
	const pool = getDroppableCosmeticIds(kind).filter(
		(id) => !isInstanceUnlocked(makeCosmeticRef(kind, id, null)),
	);
	if (pool.length === 0) {
		const other = kind === "car" ? "arena" : "car";
		const alt = getDroppableCosmeticIds(other).filter(
			(id) => !isInstanceUnlocked(makeCosmeticRef(other, id, null)),
		);
		if (alt.length === 0) return null;
		return {
			kind: other,
			id: alt[Math.floor(rng() * alt.length)]!,
		};
	}
	return { kind, id: pool[Math.floor(rng() * pool.length)]! };
}
