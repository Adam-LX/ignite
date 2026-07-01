/** Pokoje czekające na gościa (bez aktywnego meczu). */
export type WaitingRoom = { code: string; ranked?: boolean };

export function listWaitingRooms(
	rooms: Iterable<{ code: string; guest: unknown | null; ranked?: boolean }>,
): WaitingRoom[] {
	const out: WaitingRoom[] = [];
	for (const room of rooms) {
		if (!room.guest) {
			out.push({ code: room.code, ranked: room.ranked ?? false });
		}
	}
	out.sort((a, b) => a.code.localeCompare(b.code));
	return out;
}
