import { mpHttpBaseUrl } from "./protocol";

export type RankedPlayerInfo = {
	clientId: string;
	elo: number;
	wins: number;
	losses: number;
	matches: number;
};

export type RankedLeaderboard = {
	players: RankedPlayerInfo[];
};

export async function fetchMyRankedStats(
	serverRaw: string,
	clientId: string,
): Promise<RankedPlayerInfo | null> {
	const controller = new AbortController();
	const timeout = window.setTimeout(() => controller.abort(), 3000);
	try {
		const url = `${mpHttpBaseUrl(serverRaw)}/ranked/player?clientId=${encodeURIComponent(clientId)}`;
		const res = await fetch(url, {
			signal: controller.signal,
			cache: "no-store",
		});
		if (!res.ok) return null;
		return (await res.json()) as RankedPlayerInfo;
	} catch {
		return null;
	} finally {
		window.clearTimeout(timeout);
	}
}

export async function fetchRankedLeaderboard(
	serverRaw: string,
): Promise<RankedPlayerInfo[] | null> {
	const controller = new AbortController();
	const timeout = window.setTimeout(() => controller.abort(), 3000);
	try {
		const res = await fetch(`${mpHttpBaseUrl(serverRaw)}/ranked/leaderboard`, {
			signal: controller.signal,
			cache: "no-store",
		});
		if (!res.ok) return null;
		const data = (await res.json()) as RankedLeaderboard;
		return Array.isArray(data.players) ? data.players : [];
	} catch {
		return null;
	} finally {
		window.clearTimeout(timeout);
	}
}
