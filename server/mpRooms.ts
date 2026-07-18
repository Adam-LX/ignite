/** Pokoje czekające na graczy (bot-fill — nigdy „pełne” do startu). */
export type WaitingRoom = {
	code: string;
	ranked?: boolean;
	mode?: string;
	players?: number;
	maxPlayers?: number;
	botsWillFill?: number;
};

export function listWaitingRooms(
	rooms: Iterable<{
		code: string;
		clients: unknown[];
		maxPlayers: number;
		ranked?: boolean;
		mode?: string;
		matchActive?: boolean;
	}>,
): WaitingRoom[] {
	const out: WaitingRoom[] = [];
	for (const room of rooms) {
		if (room.matchActive) continue;
		if (room.clients.length >= room.maxPlayers) continue;
		const players = room.clients.length;
		out.push({
			code: room.code,
			ranked: room.ranked ?? false,
			mode: room.mode,
			players,
			maxPlayers: room.maxPlayers,
			botsWillFill: Math.max(0, room.maxPlayers - players),
		});
	}
	out.sort((a, b) => a.code.localeCompare(b.code));
	return out;
}
