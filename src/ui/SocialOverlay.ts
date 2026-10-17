import { t } from "../i18n";
import { SocialClient } from "../net/SocialClient";
import type { LobbyStatePayload } from "../net/protocol";
import {
	acceptFriend,
	addIncomingRequest,
	addOutgoingRequest,
	appendDmForPeer,
	applyPresenceSnapshot,
	cancelOutgoingRequest,
	getDmThread,
	ignoreFriendRequest,
	listFriends,
	listPendingIncoming,
	listPendingOutgoing,
	promoteOutgoingToFriend,
	removeFriend,
} from "../social/FriendsStore";
import {
	getInviteCode,
	getSocialDisplayName,
	getSocialId,
	setSocialDisplayName,
} from "../social/SocialIdentity";
import { SocialFab } from "./SocialFab";
import { SocialPanel, type SocialTab } from "./SocialPanel";

export type SocialLobbyBridge = {
	getRoomCode: () => string | null;
	getLobbyState: () => LobbyStatePayload | null;
	/** Utwórz lobby hosta jeśli brak — zwraca roomCode. */
	ensureHostRoom: () => Promise<string | null>;
	/** Pokaż lobby i dołącz po kodzie. */
	joinInviteRoom: (roomCode: string) => Promise<void>;
	subscribe: (cb: () => void) => () => void;
};

type PartyChatLine = { fromName: string; text: string; at: number };

/**
 * FAB + panel + SocialClient — montaż w menu; CSS ukrywa w `body.in-match`.
 */
export class SocialOverlay {
	private readonly fab: SocialFab;
	private readonly panel: SocialPanel;
	private readonly client = new SocialClient();
	private readonly bridge: SocialLobbyBridge;
	private open = false;
	private dmPeerId: string | null = null;
	private partyChat: PartyChatLine[] = [];
	private pendingInvite: { fromName: string; roomCode: string } | null = null;
	private statusLine = "";
	private unread = 0;
	private disposed = false;
	private unsubLobby: (() => void) | null = null;

	constructor(bridge: SocialLobbyBridge) {
		this.bridge = bridge;
		this.fab = new SocialFab(() => this.toggle());
		this.panel = new SocialPanel({
			onClose: () => this.setOpen(false),
			onAddFriend: (code) => this.addFriend(code),
			onAccept: (id) => this.accept(id),
			onIgnore: (id) => {
				ignoreFriendRequest(id);
				this.client.respondFriendRequest(id, false);
				this.refresh();
			},
			onRemove: (id) => {
				removeFriend(id);
				this.refresh();
			},
			onInviteParty: (id) => void this.inviteParty(id),
			onOpenDm: (id) => {
				this.dmPeerId = id;
				this.panel.setTab("chat");
				this.refresh();
			},
			onSendDm: (text) => this.sendDm(text),
			onSendPartyChat: (text) => {
				this.client.sendPartyChat(text);
			},
			onCopyCode: () => void this.copyCode(),
			onDisplayNameChange: (name) => {
				setSocialDisplayName(name);
				this.client.refreshHello();
				this.refresh();
			},
			onJoinInviteRoom: (code) => void this.joinInvite(code),
		});
		this.panel.root.addEventListener("social-tab", ((ev: CustomEvent<SocialTab>) => {
			this.panel.setTab(ev.detail);
			this.refresh();
		}) as EventListener);

		this.client.setCallbacks({
			onWelcome: () => {
				this.statusLine = t("social.connected");
				this.syncRoomBind();
				this.refresh();
			},
			onPresence: (entries) => {
				applyPresenceSnapshot(
					entries.map((e) => ({
						socialId: e.socialId,
						name: e.name,
						status: e.status,
					})),
				);
				this.refresh();
			},
			onFriendRequest: (msg) => {
				addIncomingRequest({
					socialId: msg.fromSocialId,
					inviteCode: msg.fromInviteCode,
					name: msg.fromName,
					at: Date.now(),
				});
				this.unread += 1;
				this.refresh();
			},
			onFriendResponse: (msg) => {
				if (msg.accept) {
					promoteOutgoingToFriend(
						msg.fromSocialId,
						msg.fromName,
						msg.fromInviteCode,
					);
				} else {
					cancelOutgoingRequest(msg.fromSocialId);
				}
				this.refresh();
			},
			onDm: (msg) => {
				const selfId = getSocialId();
				const peerId =
					msg.fromSocialId === selfId
						? this.dmPeerId
						: msg.fromSocialId;
				const other =
					msg.fromSocialId === selfId
						? (this.dmPeerId ?? msg.fromSocialId)
						: msg.fromSocialId;
				appendDmForPeer(selfId, other, {
					fromSocialId: msg.fromSocialId,
					toSocialId: msg.fromSocialId === selfId ? other : selfId,
					text: msg.text,
					at: msg.at,
				});
				if (msg.fromSocialId !== selfId) {
					if (!this.open || this.panel.getTab() !== "chat" || this.dmPeerId !== peerId) {
						this.unread += 1;
					}
					if (!this.dmPeerId) this.dmPeerId = msg.fromSocialId;
				}
				this.refresh();
			},
			onPartyInvite: (msg) => {
				this.pendingInvite = {
					fromName: msg.fromName,
					roomCode: msg.roomCode,
				};
				this.unread += 1;
				this.panel.setTab("party");
				this.refresh();
			},
			onPartyChat: (msg) => {
				this.partyChat.push({
					fromName: msg.fromName,
					text: msg.text,
					at: msg.at,
				});
				while (this.partyChat.length > 80) this.partyChat.shift();
				this.refresh();
			},
			onError: (message) => {
				this.statusLine = message;
				this.refresh();
			},
			onDisconnect: () => {
				this.statusLine = t("social.disconnected");
				this.refresh();
			},
		});

		this.unsubLobby = this.bridge.subscribe(() => {
			this.syncRoomBind();
			this.refresh();
		});

		void this.client.connect().catch((err) => {
			this.statusLine =
				err instanceof Error ? err.message : t("social.disconnected");
			this.refresh();
		});
	}

	toggle(): void {
		this.setOpen(!this.open);
	}

	setOpen(open: boolean): void {
		this.open = open;
		if (open) this.unread = 0;
		this.fab.setOpen(open);
		this.panel.setOpen(open);
		document.body.classList.toggle("social-open", open);
		this.refresh();
	}

	setMatchStatus(inMatch: boolean): void {
		this.client.setStatus(inMatch ? "inMatch" : this.bridge.getRoomCode() ? "inLobby" : "online");
		if (inMatch) this.setOpen(false);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		document.body.classList.remove("social-open");
		this.unsubLobby?.();
		this.client.disconnect();
		this.fab.dispose();
		this.panel.dispose();
	}

	private syncRoomBind(): void {
		const code = this.bridge.getRoomCode();
		if (this.client.connected) {
			this.client.bindRoom(code);
			if (!inMatchBody()) {
				this.client.setStatus(code ? "inLobby" : "online");
			}
		}
	}

	private addFriend(inviteCode: string): void {
		const code = inviteCode.trim();
		if (!code) return;
		addOutgoingRequest({
			socialId: `pending:${code}`,
			inviteCode: code,
			name: code,
			at: Date.now(),
		});
		this.client.sendFriendRequest({ toInviteCode: code });
		this.refresh();
	}

	private accept(socialId: string): void {
		acceptFriend(socialId);
		this.client.respondFriendRequest(socialId, true);
		this.refresh();
	}

	private async inviteParty(socialId: string): Promise<void> {
		let code = this.bridge.getRoomCode();
		if (!code) {
			code = await this.bridge.ensureHostRoom();
		}
		if (!code) {
			this.statusLine = t("social.needLobby");
			this.refresh();
			return;
		}
		this.syncRoomBind();
		this.client.sendPartyInvite(socialId, code);
		this.statusLine = t("social.inviteSent");
		this.refresh();
	}

	private async joinInvite(roomCode: string): Promise<void> {
		this.pendingInvite = null;
		await this.bridge.joinInviteRoom(roomCode);
		this.syncRoomBind();
		this.refresh();
	}

	private sendDm(text: string): void {
		if (!this.dmPeerId) return;
		this.client.sendDm(this.dmPeerId, text);
	}

	private async copyCode(): Promise<void> {
		try {
			await navigator.clipboard.writeText(getInviteCode());
			this.statusLine = t("social.copied");
		} catch {
			this.statusLine = getInviteCode();
		}
		this.refresh();
	}

	private refresh(): void {
		if (this.disposed) return;
		const selfId = getSocialId();
		const friends = listFriends();
		const dmPeer = this.dmPeerId
			? friends.find((f) => f.socialId === this.dmPeerId)
			: null;
		this.fab.setBadge(this.unread + listPendingIncoming().length);
		this.fab.setOpen(this.open);
		if (!this.open) return;
		this.panel.render({
			friends,
			incoming: listPendingIncoming(),
			outgoing: listPendingOutgoing(),
			dmPeerId: this.dmPeerId,
			dmPeerName: dmPeer?.name ?? getSocialDisplayName(),
			dmThread: this.dmPeerId ? getDmThread(selfId, this.dmPeerId) : [],
			selfId,
			lobby: this.bridge.getLobbyState(),
			roomCode: this.bridge.getRoomCode(),
			partyChat: this.partyChat,
			pendingInvite: this.pendingInvite,
			connected: this.client.connected,
			statusLine:
				this.statusLine ||
				(this.client.connected ? t("social.connected") : t("social.disconnected")),
		});
	}
}

function inMatchBody(): boolean {
	return typeof document !== "undefined" && document.body.classList.contains("in-match");
}
