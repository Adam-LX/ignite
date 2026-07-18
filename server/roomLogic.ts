import {
	allGameModes,
	getModeSpec,
	type GameModeId,
} from "../src/game/modes.ts";
import {
	isRankedEligibleMode,
	MP_MAX_SLOTS,
	teamForSlot,
	type LobbySlotPayload,
	type LobbyStatePayload,
} from "../src/net/protocol.ts";

const ONLINE_MODE_SET = new Set<GameModeId>(allGameModes());

const BOT_CAR_ROTATION = [
	"octane",
	"muscle",
	"truck",
	"hatch",
	"blade",
	"buggy",
	"phantom",
	"sleek",
	"bruiser",
] as const;

export function isOnlineMode(mode: GameModeId): boolean {
	return ONLINE_MODE_SET.has(mode);
}

export function resolveOnlineMode(mode?: GameModeId): GameModeId {
	if (mode && ONLINE_MODE_SET.has(mode)) return mode;
	return "1v1";
}

export function onlineMaxPlayers(mode: GameModeId): number {
	const resolved = resolveOnlineMode(mode);
	return Math.min(getModeSpec(resolved).playerCount, MP_MAX_SLOTS);
}

export function nextFreeSlot(
	used: Iterable<number>,
	maxPlayers: number,
): number | null {
	const taken = new Set(used);
	for (let s = 0; s < maxPlayers; s++) {
		if (!taken.has(s)) return s;
	}
	return null;
}

/** @deprecated Auto-full-room start — użyj canRequestStart + requestStart. */
export function shouldBeginMatch(
	clientCount: number,
	maxPlayers: number,
): boolean {
	return clientCount >= maxPlayers;
}

export type LobbyHuman = {
	slot: number;
	clientId: string;
	displayName: string;
	carId: string;
	ready: boolean;
};

export function allHumansReady(humans: Iterable<LobbyHuman>): boolean {
	let count = 0;
	for (const h of humans) {
		count++;
		if (!h.ready) return false;
	}
	return count > 0;
}

/**
 * Host może wystartować solo (bot-fill) albo gdy wszyscy Ready / force.
 * Ranked wymaga ≥2 ludzi.
 */
export function canRequestStart(opts: {
	humanCount: number;
	allReady: boolean;
	force: boolean;
	ranked: boolean;
}): boolean {
	if (opts.humanCount < 1) return false;
	if (opts.ranked && opts.humanCount < 2) return false;
	if (opts.force) return true;
	return opts.allReady;
}

export function sanitizeRankedFlag(
	ranked: boolean,
	mode: GameModeId,
): boolean {
	return ranked && isRankedEligibleMode(mode);
}

export function botCarIdForSlot(slot: number): string {
	return BOT_CAR_ROTATION[slot % BOT_CAR_ROTATION.length] ?? "octane";
}

export function buildLobbyState(opts: {
	mode: GameModeId;
	maxPlayers: number;
	humans: LobbyHuman[];
	ranked: boolean;
}): LobbyStatePayload {
	const bySlot = new Map(opts.humans.map((h) => [h.slot, h]));
	const slots: LobbySlotPayload[] = [];
	let botIndex = 0;
	for (let slot = 0; slot < opts.maxPlayers; slot++) {
		const human = bySlot.get(slot);
		if (human) {
			slots.push({
				slot,
				peerId: human.clientId,
				name: human.displayName || `Player ${slot + 1}`,
				carId: human.carId || "octane",
				ready: human.ready,
				team: teamForSlot(slot, opts.mode),
				isBot: false,
			});
		} else {
			botIndex++;
			slots.push({
				slot,
				peerId: null,
				name: `Bot ${botIndex}`,
				carId: botCarIdForSlot(slot),
				ready: true,
				team: teamForSlot(slot, opts.mode),
				isBot: true,
			});
		}
	}
	const humans = opts.humans;
	const allReady = allHumansReady(humans);
	return {
		mode: opts.mode,
		maxPlayers: opts.maxPlayers,
		slots,
		canStart: canRequestStart({
			humanCount: humans.length,
			allReady,
			force: true,
			ranked: opts.ranked,
		}),
		allHumansReady: allReady,
	};
}
