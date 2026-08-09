import type {
	ClientMessage,
	ServerMessage,
	SocialPresenceEntry,
	SocialPresenceStatus,
} from "./protocol";
import { resolveWsUrl } from "./protocol";
import { getMpServerAddress } from "./serverStatus";
import {
	getInviteCode,
	getSocialDisplayName,
	getSocialId,
} from "../social/SocialIdentity";

export type SocialClientCallbacks = {
	onWelcome?: (self: SocialPresenceEntry) => void;
	onPresence?: (entries: SocialPresenceEntry[]) => void;
	onFriendRequest?: (msg: {
		fromSocialId: string;
		fromInviteCode: string;
		fromName: string;
	}) => void;
	onFriendResponse?: (msg: {
		fromSocialId: string;
		fromInviteCode: string;
		fromName: string;
		accept: boolean;
	}) => void;
	onDm?: (msg: {
		fromSocialId: string;
		fromName: string;
		text: string;
		at: number;
	}) => void;
	onPartyInvite?: (msg: {
		fromSocialId: string;
		fromName: string;
		roomCode: string;
	}) => void;
	onPartyChat?: (msg: {
		fromSocialId: string;
		fromName: string;
		text: string;
		at: number;
	}) => void;
	onError?: (message: string) => void;
	onDisconnect?: () => void;
};

export class SocialClient {
	private ws: WebSocket | null = null;
	private callbacks: SocialClientCallbacks = {};
	private _connected = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private intentionalClose = false;
	private lastServerRaw = "";

	get connected(): boolean {
		return this._connected;
	}

	setCallbacks(cb: SocialClientCallbacks): void {
		this.callbacks = { ...this.callbacks, ...cb };
	}

	connect(serverRaw = getMpServerAddress()): Promise<void> {
		this.intentionalClose = false;
		this.lastServerRaw = serverRaw;
		return new Promise((resolve, reject) => {
			if (this.ws) this.disconnect();
			const url = resolveWsUrl(serverRaw);
			let settled = false;
			const ws = new WebSocket(url);
			this.ws = ws;

			ws.onopen = () => {
				this._connected = true;
				this.sendHello();
				if (!settled) {
					settled = true;
					resolve();
				}
			};
			ws.onerror = () => {
				if (!settled) {
					settled = true;
					reject(new Error("SocialClient: połączenie nieudane"));
				}
			};
			ws.onclose = () => {
				this._connected = false;
				this.ws = null;
				this.callbacks.onDisconnect?.();
				if (!this.intentionalClose) this.scheduleReconnect();
			};
			ws.onmessage = (ev) => {
				this.onMessage(String(ev.data));
			};
		});
	}

	disconnect(): void {
		this.intentionalClose = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.ws?.close();
		this.ws = null;
		this._connected = false;
	}

	setStatus(status: SocialPresenceStatus): void {
		this.send({ type: "socialSetStatus", status });
	}

	sendFriendRequest(opts: { toInviteCode?: string; toSocialId?: string }): void {
		this.send({
			type: "socialFriendRequest",
			toInviteCode: opts.toInviteCode,
			toSocialId: opts.toSocialId,
		});
	}

	respondFriendRequest(fromSocialId: string, accept: boolean): void {
		this.send({ type: "socialFriendResponse", fromSocialId, accept });
	}

	sendDm(toSocialId: string, text: string): void {
		this.send({ type: "socialDm", toSocialId, text });
	}

	sendPartyInvite(toSocialId: string, roomCode: string): void {
		this.send({ type: "socialPartyInvite", toSocialId, roomCode });
	}

	sendPartyChat(text: string): void {
		this.send({ type: "socialPartyChat", text });
	}

	bindRoom(roomCode: string | null): void {
		this.send({ type: "socialBindRoom", roomCode });
	}

	refreshHello(): void {
		if (this._connected) this.sendHello();
	}

	private sendHello(): void {
		this.send({
			type: "socialHello",
			socialId: getSocialId(),
			inviteCode: getInviteCode(),
			displayName: getSocialDisplayName(),
			status: "online",
		});
	}

	private send(msg: ClientMessage): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		this.ws.send(JSON.stringify(msg));
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			void this.connect(this.lastServerRaw || getMpServerAddress()).catch(() => {
				this.scheduleReconnect();
			});
		}, 4000);
	}

	private onMessage(raw: string): void {
		let msg: ServerMessage;
		try {
			msg = JSON.parse(raw) as ServerMessage;
		} catch {
			return;
		}
		switch (msg.type) {
			case "socialWelcome":
				this.callbacks.onWelcome?.(msg.self);
				break;
			case "socialPresence":
				this.callbacks.onPresence?.(msg.entries);
				break;
			case "socialFriendRequest":
				this.callbacks.onFriendRequest?.(msg);
				break;
			case "socialFriendResponse":
				this.callbacks.onFriendResponse?.(msg);
				break;
			case "socialDm":
				this.callbacks.onDm?.(msg);
				break;
			case "socialPartyInvite":
				this.callbacks.onPartyInvite?.(msg);
				break;
			case "socialPartyChat":
				this.callbacks.onPartyChat?.(msg);
				break;
			case "error":
				this.callbacks.onError?.(msg.message);
				break;
			default:
				break;
		}
	}
}
