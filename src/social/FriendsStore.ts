import { normalizeInviteCode } from "./SocialIdentity";

export type FriendPresenceStatus = "offline" | "online" | "inLobby" | "inMatch";

export type FriendEntry = {
	socialId: string;
	inviteCode: string;
	name: string;
	status: FriendPresenceStatus;
	lastSeen: number;
};

export type FriendRequest = {
	socialId: string;
	inviteCode: string;
	name: string;
	at: number;
};

export type DmMessage = {
	id: string;
	fromSocialId: string;
	toSocialId: string;
	text: string;
	at: number;
};

export type FriendsStoreData = {
	schemaVersion: 1;
	friends: FriendEntry[];
	pendingIncoming: FriendRequest[];
	pendingOutgoing: FriendRequest[];
	/** Klucz = peer socialId. */
	dmByPeer: Record<string, DmMessage[]>;
};

const STORAGE_KEY = "ignite.friends.v1";
const MAX_DM_PER_PEER = 80;

const emptyStore = (): FriendsStoreData => ({
	schemaVersion: 1,
	friends: [],
	pendingIncoming: [],
	pendingOutgoing: [],
	dmByPeer: {},
});

let memory: FriendsStoreData | null = null;

function read(): FriendsStoreData {
	if (memory) return memory;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as FriendsStoreData;
			if (parsed?.schemaVersion === 1 && Array.isArray(parsed.friends)) {
				memory = {
					schemaVersion: 1,
					friends: parsed.friends ?? [],
					pendingIncoming: parsed.pendingIncoming ?? [],
					pendingOutgoing: parsed.pendingOutgoing ?? [],
					dmByPeer: parsed.dmByPeer ?? {},
				};
				return memory;
			}
		}
	} catch {
		/* */
	}
	memory = emptyStore();
	return memory;
}

function write(data: FriendsStoreData): void {
	memory = data;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch {
		/* */
	}
}

export function getFriendsStore(): FriendsStoreData {
	return structuredClone(read());
}

export function listFriends(): FriendEntry[] {
	return [...read().friends].sort((a, b) => {
		const rank = (s: FriendPresenceStatus) =>
			s === "inMatch" ? 0 : s === "inLobby" ? 1 : s === "online" ? 2 : 3;
		const d = rank(a.status) - rank(b.status);
		if (d !== 0) return d;
		return a.name.localeCompare(b.name);
	});
}

export function listPendingIncoming(): FriendRequest[] {
	return [...read().pendingIncoming];
}

export function listPendingOutgoing(): FriendRequest[] {
	return [...read().pendingOutgoing];
}

/** Lokalne dodanie outgoing (przed ACK serwera). */
export function addOutgoingRequest(req: FriendRequest): void {
	const data = read();
	const code = normalizeInviteCode(req.inviteCode);
	if (data.friends.some((f) => f.socialId === req.socialId || f.inviteCode === code)) {
		return;
	}
	data.pendingOutgoing = data.pendingOutgoing.filter(
		(p) => p.socialId !== req.socialId && p.inviteCode !== code,
	);
	data.pendingOutgoing.push({ ...req, inviteCode: code });
	write(data);
}

export function addIncomingRequest(req: FriendRequest): void {
	const data = read();
	const code = normalizeInviteCode(req.inviteCode);
	if (data.friends.some((f) => f.socialId === req.socialId)) return;
	if (data.pendingIncoming.some((p) => p.socialId === req.socialId)) return;
	data.pendingIncoming.push({ ...req, inviteCode: code });
	write(data);
}

export function acceptFriend(socialId: string): FriendEntry | null {
	const data = read();
	const idx = data.pendingIncoming.findIndex((p) => p.socialId === socialId);
	if (idx < 0) return null;
	const [req] = data.pendingIncoming.splice(idx, 1);
	if (!req) return null;
	data.pendingOutgoing = data.pendingOutgoing.filter((p) => p.socialId !== socialId);
	const entry: FriendEntry = {
		socialId: req.socialId,
		inviteCode: req.inviteCode,
		name: req.name || "Player",
		status: "offline",
		lastSeen: Date.now(),
	};
	data.friends = data.friends.filter((f) => f.socialId !== socialId);
	data.friends.push(entry);
	write(data);
	return entry;
}

export function ignoreFriendRequest(socialId: string): void {
	const data = read();
	data.pendingIncoming = data.pendingIncoming.filter((p) => p.socialId !== socialId);
	write(data);
}

export function cancelOutgoingRequest(socialId: string): void {
	const data = read();
	data.pendingOutgoing = data.pendingOutgoing.filter((p) => p.socialId !== socialId);
	write(data);
}

/** Po akceptacji drugiej strony — dopisz znajomego z outgoing. */
export function promoteOutgoingToFriend(
	socialId: string,
	name: string,
	inviteCode: string,
): FriendEntry {
	const data = read();
	const code = normalizeInviteCode(inviteCode);
	data.pendingOutgoing = data.pendingOutgoing.filter(
		(p) => p.socialId !== socialId && p.inviteCode !== code,
	);
	data.pendingIncoming = data.pendingIncoming.filter(
		(p) => p.socialId !== socialId && p.inviteCode !== code,
	);
	const entry: FriendEntry = {
		socialId,
		inviteCode: code,
		name: name || "Player",
		status: "online",
		lastSeen: Date.now(),
	};
	data.friends = data.friends.filter((f) => f.socialId !== socialId);
	data.friends.push(entry);
	write(data);
	return entry;
}

export function removeFriend(socialId: string): void {
	const data = read();
	data.friends = data.friends.filter((f) => f.socialId !== socialId);
	write(data);
}

export function upsertFriendPresence(
	socialId: string,
	patch: Partial<Pick<FriendEntry, "name" | "status" | "inviteCode">>,
): void {
	const data = read();
	const f = data.friends.find((x) => x.socialId === socialId);
	if (!f) return;
	if (patch.name) f.name = patch.name;
	if (patch.status) f.status = patch.status;
	if (patch.inviteCode) f.inviteCode = normalizeInviteCode(patch.inviteCode);
	f.lastSeen = Date.now();
	write(data);
}

export function applyPresenceSnapshot(
	entries: { socialId: string; name: string; status: FriendPresenceStatus }[],
): void {
	const data = read();
	const map = new Map(entries.map((e) => [e.socialId, e]));
	for (const f of data.friends) {
		const hit = map.get(f.socialId);
		if (hit) {
			f.name = hit.name || f.name;
			f.status = hit.status;
			f.lastSeen = Date.now();
		} else if (f.status !== "offline") {
			f.status = "offline";
		}
	}
	write(data);
}

export function dmThreadKey(a: string, b: string): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function getDmThread(selfId: string, peerId: string): DmMessage[] {
	const data = read();
	return [...(data.dmByPeer[dmThreadKey(selfId, peerId)] ?? [])];
}

export function appendDmForPeer(
	selfId: string,
	peerId: string,
	msg: Omit<DmMessage, "id"> & { id?: string },
): DmMessage {
	const full: DmMessage = {
		id: msg.id ?? `dm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
		fromSocialId: msg.fromSocialId,
		toSocialId: msg.toSocialId,
		text: msg.text.slice(0, 280),
		at: msg.at,
	};
	const data = read();
	const key = dmThreadKey(selfId, peerId);
	const list = data.dmByPeer[key] ?? [];
	list.push(full);
	while (list.length > MAX_DM_PER_PEER) list.shift();
	data.dmByPeer[key] = list;
	write(data);
	return full;
}

export function resetFriendsStoreForTests(): void {
	memory = emptyStore();
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* */
	}
}

export function setFriendsStoreForTests(data: FriendsStoreData | null): void {
	memory = data ? structuredClone(data) : null;
}
