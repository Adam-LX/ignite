/** Pokoje czekające na graczy. */
export type WaitingRoom = {
	code: string;
	ranked?: boolean;
	mode?: string;
	players?: number;
	maxPlayers?: number;
	/** Ile botów dojdzie przy starcie (0 gdy fillBots wyłączone). */
	botsWillFill?: number;
	fillBots?: boolean;
};

export function listWaitingRooms(
	rooms: Iterable<{
		code: string;
		clients: unknown[];
		maxPlayers: number;
		ranked?: boolean;
		mode?: string;
		matchActive?: boolean;
		fillBots?: boolean;
	}>,
): WaitingRoom[] {
	const out: WaitingRoom[] = [];
	for (const room of rooms) {
		if (room.matchActive) continue;
		if (room.clients.length >= room.maxPlayers) continue;
		const players = room.clients.length;
		const fillBots = Boolean(room.fillBots);
		out.push({
			code: room.code,
			ranked: room.ranked ?? false,
			mode: room.mode,
			players,
			maxPlayers: room.maxPlayers,
			fillBots,
			botsWillFill: fillBots
				? Math.max(0, room.maxPlayers - players)
				: 0,
		});
	}
	out.sort((a, b) => a.code.localeCompare(b.code));
	return out;
}
