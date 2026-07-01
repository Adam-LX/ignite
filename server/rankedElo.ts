import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DATA_DIR = resolve(process.cwd(), "data");
const ELO_PATH = resolve(DATA_DIR, "ranked-elo.json");
const DEFAULT_ELO = 1000;
const K_FACTOR = 32;

export type RankedPlayer = {
	clientId: string;
	elo: number;
	wins: number;
	losses: number;
	matches: number;
	updatedAt: string;
};

type RankedStore = {
	players: Record<string, RankedPlayer>;
};

function loadStore(): RankedStore {
	try {
		if (!existsSync(ELO_PATH)) return { players: {} };
		const raw = readFileSync(ELO_PATH, "utf8");
		const parsed = JSON.parse(raw) as RankedStore;
		if (!parsed.players || typeof parsed.players !== "object") {
			return { players: {} };
		}
		return parsed;
	} catch {
		return { players: {} };
	}
}

function saveStore(store: RankedStore): void {
	mkdirSync(DATA_DIR, { recursive: true });
	writeFileSync(ELO_PATH, JSON.stringify(store, null, 2));
}

export function expectedScore(ratingA: number, ratingB: number): number {
	return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function eloDelta(
	winnerRating: number,
	loserRating: number,
	k = K_FACTOR,
): number {
	const expected = expectedScore(winnerRating, loserRating);
	return Math.round(k * (1 - expected));
}

export function getRankedPlayer(clientId: string): RankedPlayer {
	const store = loadStore();
	const existing = store.players[clientId];
	if (existing) return existing;
	return {
		clientId,
		elo: DEFAULT_ELO,
		wins: 0,
		losses: 0,
		matches: 0,
		updatedAt: new Date(0).toISOString(),
	};
}

export function getLeaderboard(limit = 20): RankedPlayer[] {
	const store = loadStore();
	return Object.values(store.players)
		.filter((p) => p.matches > 0)
		.sort((a, b) => b.elo - a.elo || b.matches - a.matches)
		.slice(0, limit);
}

export type RankedMatchResult = {
	hostClientId: string;
	guestClientId: string;
	blueScore: number;
	orangeScore: number;
};

/** Slot 0 = blue (host), slot 1 = orange (guest). Forfeit = 3–0 dla zwycięzcy. */
export function rankedForfeitScores(loserSlot: 0 | 1): {
	blueScore: number;
	orangeScore: number;
} {
	return loserSlot === 0
		? { blueScore: 0, orangeScore: 3 }
		: { blueScore: 3, orangeScore: 0 };
}

export function applyRankedMatch(result: RankedMatchResult): {
	host: RankedPlayer;
	guest: RankedPlayer;
	hostDelta: number;
	guestDelta: number;
} {
	const store = loadStore();
	const host = { ...getRankedPlayer(result.hostClientId) };
	const guest = { ...getRankedPlayer(result.guestClientId) };

	if (result.blueScore === result.orangeScore) {
		return { host, guest, hostDelta: 0, guestDelta: 0 };
	}

	const hostWon = result.blueScore > result.orangeScore;
	const winner = hostWon ? host : guest;
	const loser = hostWon ? guest : host;
	const delta = eloDelta(winner.elo, loser.elo);

	winner.elo += delta;
	winner.wins += 1;
	winner.matches += 1;
	winner.updatedAt = new Date().toISOString();

	loser.elo = Math.max(100, loser.elo - delta);
	loser.losses += 1;
	loser.matches += 1;
	loser.updatedAt = new Date().toISOString();

	store.players[host.clientId] = host;
	store.players[guest.clientId] = guest;
	saveStore(store);

	return {
		host,
		guest,
		hostDelta: hostWon ? delta : -delta,
		guestDelta: hostWon ? -delta : delta,
	};
}

export function rankedPathForLogs(): string {
	return ELO_PATH;
}
