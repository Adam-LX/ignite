import { isoWeekKey } from "../modes/MutatorRegistry";
import { ArenaRuntime } from "../arena/ArenaRuntime";
import { getCarEntry, resolveCarId } from "./CarCatalog";
import {
	instanceKey,
	type CosmeticRef,
	type ItemProvenance,
} from "./CosmeticCatalog";
import { rollCrateItem } from "./DropTable";
import {
	getEquippedCarId,
	getPlayerInventory,
	savePlayerInventory,
	type PlayerInventoryData,
	unlockInstance,
} from "./PlayerInventory";

export type DuelContractStatus = "active" | "won" | "lost";

export type DuelContractState = {
	weekKey: string;
	carId: string;
	wins: number;
	losses: number;
	status: DuelContractStatus;
	/** instanceKey of granted reward when won */
	rewardKey?: string;
};

export type PlayerInventoryWithDuel = PlayerInventoryData & {
	duelContract?: DuelContractState | null;
};

const WINS_TO_CLAIM = 2;
const LOSSES_TO_FAIL = 2;

function sanitizeContract(raw: unknown): DuelContractState | null {
	if (!raw || typeof raw !== "object") return null;
	const d = raw as Record<string, unknown>;
	if (typeof d.weekKey !== "string" || !d.weekKey) return null;
	if (typeof d.carId !== "string" || !d.carId) return null;
	if (d.status !== "active" && d.status !== "won" && d.status !== "lost") {
		return null;
	}
	const wins =
		typeof d.wins === "number" && d.wins >= 0 ? Math.floor(d.wins) : 0;
	const losses =
		typeof d.losses === "number" && d.losses >= 0 ? Math.floor(d.losses) : 0;
	return {
		weekKey: d.weekKey,
		carId: resolveCarId(d.carId),
		wins,
		losses,
		status: d.status,
		rewardKey: typeof d.rewardKey === "string" ? d.rewardKey : undefined,
	};
}

export function readDuelContract(
	inv: PlayerInventoryData = getPlayerInventory(),
): DuelContractState | null {
	return sanitizeContract((inv as PlayerInventoryWithDuel).duelContract);
}

function writeDuelContract(next: DuelContractState | null): void {
	const inv = getPlayerInventory() as PlayerInventoryWithDuel;
	if (next) inv.duelContract = next;
	else delete inv.duelContract;
	savePlayerInventory(inv);
}

export function getActiveDuelContract(
	date: Date = new Date(),
): DuelContractState | null {
	const c = readDuelContract();
	if (!c || c.status !== "active") return null;
	if (c.weekKey !== isoWeekKey(date)) return null;
	return c;
}

/** Car locked for matchmaking while an active contract is live. */
export function getDuelLockedCarId(date?: Date): string | null {
	return getActiveDuelContract(date)?.carId ?? null;
}

export function getMatchCarId(): string {
	return getDuelLockedCarId() ?? getEquippedCarId();
}

export function canAcceptDuelContract(date: Date = new Date()): boolean {
	const existing = readDuelContract();
	/** Jeden kontrakt na tydzień ISO (wygrana / przegrana / aktywny). */
	if (existing && existing.weekKey === isoWeekKey(date)) {
		return false;
	}
	return Boolean(getCarEntry(getEquippedCarId()));
}

export function acceptDuelContract(
	carId: string = getEquippedCarId(),
	date: Date = new Date(),
): DuelContractState {
	const resolved = resolveCarId(carId);
	const next: DuelContractState = {
		weekKey: isoWeekKey(date),
		carId: resolved,
		wins: 0,
		losses: 0,
		status: "active",
	};
	writeDuelContract(next);
	return next;
}

export function abandonDuelContract(): void {
	const c = readDuelContract();
	if (!c || c.status !== "active") return;
	writeDuelContract({ ...c, status: "lost" });
}

export type DuelContractMatchResult = {
	contract: DuelContractState;
	reward: CosmeticRef | null;
	justFinished: boolean;
};

function grantReward(rng: () => number): CosmeticRef | null {
	/** forcePity → guaranteed epic-tier pick from crate rules (= rare+ reward). */
	let item = rollCrateItem(rng, true);
	if (!item) item = rollCrateItem(rng, false);
	if (!item) return null;
	const provenance: ItemProvenance = {
		source: "duel_contract",
		arenaId: ArenaRuntime.getId(),
		unlockedAt: Date.now(),
	};
	unlockInstance(item, true, provenance);
	return item;
}

/**
 * Record a finished 1v1 toward the active BO3 contract.
 * Only `1v1` mode counts.
 */
export function recordDuelContractMatch(
	won: boolean,
	modeId: string,
	rng: () => number = Math.random,
	date: Date = new Date(),
): DuelContractMatchResult | null {
	if (modeId !== "1v1") return null;
	const active = getActiveDuelContract(date);
	if (!active) return null;

	const next: DuelContractState = {
		...active,
		wins: active.wins + (won ? 1 : 0),
		losses: active.losses + (won ? 0 : 1),
	};

	let reward: CosmeticRef | null = null;
	let justFinished = false;

	if (next.wins >= WINS_TO_CLAIM) {
		next.status = "won";
		justFinished = true;
		reward = grantReward(rng);
		if (reward) next.rewardKey = instanceKey(reward);
	} else if (next.losses >= LOSSES_TO_FAIL) {
		next.status = "lost";
		justFinished = true;
	}

	writeDuelContract(next);
	return { contract: next, reward, justFinished };
}

export function duelContractProgressLabel(c: DuelContractState): string {
	return `${c.wins}–${c.losses}`;
}

/** Test helper */
export function clearDuelContractForTests(): void {
	writeDuelContract(null);
}
