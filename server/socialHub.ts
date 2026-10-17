import type {
	ClientMessage,
	ServerMessage,
	SocialPresenceEntry,
	SocialPresenceStatus,
} from "../src/net/protocol.ts";

export type SocialSend = (msg: ServerMessage) => void;

export type SocialPeer = {
	socialId: string;
	inviteCode: string;
	displayName: string;
	status: SocialPresenceStatus;
	send: SocialSend;
	/** Kod lobby powiązany z SocialClient (party chat). */
	roomCode: string | null;
};

function normCode(raw: string): string {
	const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
	if (cleaned.startsWith("IGN-")) return cleaned;
	if (/^[A-Z0-9]{4}$/.test(cleaned)) return `IGN-${cleaned}`;
	return cleaned;
}

export class SocialHub {
	private readonly bySocialId = new Map<string, SocialPeer>();
	private readonly byInviteCode = new Map<string, string>();
	private readonly bySend = new Map<SocialSend, string>();

	hello(
		send: SocialSend,
		socialId: string,
		inviteCode: string,
		displayName: string,
		status: SocialPresenceStatus = "online",
	): SocialPresenceEntry {
		const code = normCode(inviteCode);
		const name = (displayName.trim() || "Player").slice(0, 24);
		const prev = this.bySend.get(send);
		if (prev && prev !== socialId) {
			this.disconnect(send);
		}
		const existing = this.bySocialId.get(socialId);
		if (existing && existing.send !== send) {
			/** Nowy socket zastępuje stary. */
			this.bySend.delete(existing.send);
		}
		const peer: SocialPeer = {
			socialId,
			inviteCode: code,
			displayName: name,
			status,
			send,
			roomCode: existing?.send === send ? existing.roomCode : null,
		};
		this.bySocialId.set(socialId, peer);
		this.byInviteCode.set(code, socialId);
		this.bySend.set(send, socialId);
		const self: SocialPresenceEntry = {
			socialId,
			inviteCode: code,
			name,
			status,
		};
		send({ type: "socialWelcome", self });
		this.broadcastPresence();
		return self;
	}

	setStatus(send: SocialSend, status: SocialPresenceStatus): void {
		const id = this.bySend.get(send);
		if (!id) return;
		const peer = this.bySocialId.get(id);
		if (!peer) return;
		peer.status = status;
		this.broadcastPresence();
	}

	disconnect(send: SocialSend): void {
		const id = this.bySend.get(send);
		if (!id) return;
		this.bySend.delete(send);
		const peer = this.bySocialId.get(id);
		if (peer && peer.send === send) {
			this.bySocialId.delete(id);
			this.byInviteCode.delete(peer.inviteCode);
			this.broadcastPresence();
		}
	}

	handle(send: SocialSend, msg: ClientMessage): boolean {
		if (msg.type === "socialHello") {
			this.hello(
				send,
				msg.socialId,
				msg.inviteCode,
				msg.displayName,
				msg.status ?? "online",
			);
			return true;
		}
		if (msg.type === "socialSetStatus") {
			this.setStatus(send, msg.status);
			return true;
		}
		if (msg.type === "socialBindRoom") {
			const id = this.bySend.get(send);
			if (!id) {
				send({ type: "error", message: "socialHello required" });
				return true;
			}
			const peer = this.bySocialId.get(id);
			if (!peer) return true;
			const code = msg.roomCode?.trim().toUpperCase() || null;
			peer.roomCode = code;
			if (code) peer.status = peer.status === "inMatch" ? "inMatch" : "inLobby";
			else if (peer.status === "inLobby") peer.status = "online";
			this.broadcastPresence();
			return true;
		}
		const fromId = this.bySend.get(send);
		if (!fromId) {
			if (
				msg.type === "socialFriendRequest" ||
				msg.type === "socialFriendResponse" ||
				msg.type === "socialDm" ||
				msg.type === "socialPartyInvite" ||
				msg.type === "socialPartyChat" ||
				msg.type === "socialBindRoom"
			) {
				send({ type: "error", message: "socialHello required" });
				return true;
			}
			return false;
		}
		const from = this.bySocialId.get(fromId);
		if (!from) return false;

		if (msg.type === "socialFriendRequest") {
			let targetId = msg.toSocialId?.trim() || "";
			if (!targetId && msg.toInviteCode) {
				targetId = this.byInviteCode.get(normCode(msg.toInviteCode)) ?? "";
			}
			if (!targetId || targetId === fromId) {
				send({ type: "error", message: "Nie znaleziono gracza (musi być online)" });
				return true;
			}
			const target = this.bySocialId.get(targetId);
			if (!target) {
				send({ type: "error", message: "Nie znaleziono gracza (musi być online)" });
				return true;
			}
			target.send({
				type: "socialFriendRequest",
				fromSocialId: from.socialId,
				fromInviteCode: from.inviteCode,
				fromName: from.displayName,
			});
			return true;
		}

		if (msg.type === "socialFriendResponse") {
			const target = this.bySocialId.get(msg.fromSocialId);
			if (!target) {
				send({ type: "error", message: "Gracz offline" });
				return true;
			}
			target.send({
				type: "socialFriendResponse",
				fromSocialId: from.socialId,
				fromInviteCode: from.inviteCode,
				fromName: from.displayName,
				accept: Boolean(msg.accept),
			});
			return true;
		}

		if (msg.type === "socialDm") {
			const text = msg.text.trim().slice(0, 280);
			if (!text) return true;
			const target = this.bySocialId.get(msg.toSocialId);
			if (!target) {
				send({ type: "error", message: "Gracz offline" });
				return true;
			}
			const at = Date.now();
			target.send({
				type: "socialDm",
				fromSocialId: from.socialId,
				fromName: from.displayName,
				text,
				at,
			});
			/** Echo do nadawcy — spójna historia. */
			send({
				type: "socialDm",
				fromSocialId: from.socialId,
				fromName: from.displayName,
				text,
				at,
			});
			return true;
		}

		if (msg.type === "socialPartyInvite") {
			const target = this.bySocialId.get(msg.toSocialId);
			if (!target) {
				send({ type: "error", message: "Gracz offline" });
				return true;
			}
			const code = msg.roomCode.trim().toUpperCase();
			if (!code) return true;
			target.send({
				type: "socialPartyInvite",
				fromSocialId: from.socialId,
				fromName: from.displayName,
				roomCode: code,
			});
			return true;
		}

		if (msg.type === "socialPartyChat") {
			const code = from.roomCode;
			if (!code) {
				send({ type: "error", message: "Brak party (dołącz do lobby)" });
				return true;
			}
			this.broadcastPartyChat(
				from,
				msg.text,
				this.sendsInRoom(code),
			);
			return true;
		}

		return false;
	}

	sendsInRoom(roomCode: string): SocialSend[] {
		const code = roomCode.trim().toUpperCase();
		const out: SocialSend[] = [];
		for (const peer of this.bySocialId.values()) {
			if (peer.roomCode === code) out.push(peer.send);
		}
		return out;
	}

	/** Broadcast party chat do podanych sendów (gracze w tym samym room). */
	broadcastPartyChat(
		from: SocialPeer,
		text: string,
		recipients: SocialSend[],
	): void {
		const cleaned = text.trim().slice(0, 280);
		if (!cleaned) return;
		const at = Date.now();
		const msg: ServerMessage = {
			type: "socialPartyChat",
			fromSocialId: from.socialId,
			fromName: from.displayName,
			text: cleaned,
			at,
		};
		for (const r of recipients) r(msg);
	}

	getPeerBySend(send: SocialSend): SocialPeer | null {
		const id = this.bySend.get(send);
		if (!id) return null;
		return this.bySocialId.get(id) ?? null;
	}

	getPeerBySocialId(socialId: string): SocialPeer | null {
		return this.bySocialId.get(socialId) ?? null;
	}

	presenceSnapshot(): SocialPresenceEntry[] {
		return [...this.bySocialId.values()].map((p) => ({
			socialId: p.socialId,
			inviteCode: p.inviteCode,
			name: p.displayName,
			status: p.status,
		}));
	}

	private broadcastPresence(): void {
		const entries = this.presenceSnapshot();
		const msg: ServerMessage = { type: "socialPresence", entries };
		for (const peer of this.bySocialId.values()) {
			peer.send(msg);
		}
	}
}
