import type { GameModeId } from "../game/modes";
import type GameInput from "../util/GameInput";
import { getMpClientId } from "./mpClientId";
import type {
	ClientMessage,
	InputFramePayload,
	OnlineRole,
	ServerMessage,
	WorldSnapshotPayload,
} from "./protocol";
import { resolveWsUrl } from "./protocol";

export type RoomClientCallbacks = {
	onWelcome?: (
		roomCode: string,
		slot: number,
		role: OnlineRole,
		ranked: boolean,
		elo?: number,
	) => void;
	onPeerJoined?: () => void;
	onPeerLeft?: (reason?: string) => void;
	onStartMatch?: (mode: GameModeId, seed: number, ranked: boolean) => void;
	onRankedResult?: (eloBefore: number, eloAfter: number, delta: number) => void;
	onSnapshot?: (snapshot: WorldSnapshotPayload) => void;
	onInputFrame?: (frame: InputFramePayload, fromSlot: number) => void;
	onError?: (message: string) => void;
	onDisconnect?: () => void;
};

export class RoomClient {
	private ws: WebSocket | null = null;
	private seq = 0;
	private tick = 0;
	private callbacks: RoomClientCallbacks = {};

	private _role: OnlineRole | null = null;
	private _ranked = false;
	roomCode: string | null = null;
	slot: number | null = null;
	elo: number | null = null;

	get role(): OnlineRole | null {
		return this._role;
	}

	get ranked(): boolean {
		return this._ranked;
	}

	setCallbacks(callbacks: RoomClientCallbacks): void {
		this.callbacks = { ...this.callbacks, ...callbacks };
	}

	/** `serverRaw` — host:port, ws:// lub wss:// (jak z getMpServerAddress). */
	connect(serverRaw: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.ws) {
				this.disconnect();
			}

			const url = resolveWsUrl(serverRaw);
			const ws = new WebSocket(url);
			this.ws = ws;

			ws.onopen = () => resolve();
			ws.onerror = () => reject(new Error(`Nie można połączyć z ${url}`));
			ws.onclose = () => {
				this.callbacks.onDisconnect?.();
			};
			ws.onmessage = (ev) => {
				this.handleMessage(ev.data as string);
			};
		});
	}

	disconnect(): void {
		this.ws?.close();
		this.ws = null;
	}

	isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	send(msg: ClientMessage): void {
		if (!this.isConnected()) return;
		this.ws!.send(JSON.stringify(msg));
	}

	createRoom(ranked = false): void {
		this._ranked = ranked;
		this.send({
			type: "createRoom",
			ranked,
			clientId: getMpClientId(),
		});
	}

	joinRoom(roomCode: string): void {
		this.send({
			type: "joinRoom",
			roomCode: roomCode.trim().toUpperCase(),
			clientId: getMpClientId(),
		});
	}

	reportMatch(blueScore: number, orangeScore: number): void {
		this.send({ type: "reportMatch", blueScore, orangeScore });
	}

	requestRematch(): void {
		this.send({ type: "rematch" });
	}

	sendSnapshot(snapshot: WorldSnapshotPayload): void {
		this.send({ type: "snapshot", snapshot });
	}

	sendInputFromGameInput(input: GameInput): void {
		const jumpEdge = input.consumeJump();
		const recover = input.consumeRecover();

		const frame: InputFramePayload = {
			seq: ++this.seq,
			tickHint: ++this.tick,
			forward: input.forward(),
			yaw: input.yaw(),
			roll: input.roll(),
			boost: input.isBoosting(),
			jumpHeld: input.isJumpHeld(),
			jumpEdge,
			recover,
		};
		this.send({ type: "inputFrame", frame });
	}

	private handleMessage(raw: string): void {
		let msg: ServerMessage;
		try {
			msg = JSON.parse(raw) as ServerMessage;
		} catch {
			this.callbacks.onError?.("Nieprawidłowa wiadomość serwera");
			return;
		}

		switch (msg.type) {
			case "welcome":
				this.roomCode = msg.roomCode;
				this.slot = msg.slot;
				this._role = msg.role;
				this._ranked = Boolean(msg.ranked);
				this.elo = msg.elo ?? null;
				this.callbacks.onWelcome?.(
					msg.roomCode,
					msg.slot,
					msg.role,
					Boolean(msg.ranked),
					msg.elo,
				);
				break;
			case "peerJoined":
				this.callbacks.onPeerJoined?.();
				break;
			case "peerLeft":
				this.callbacks.onPeerLeft?.(msg.reason);
				break;
			case "startMatch":
				this._ranked = Boolean(msg.ranked);
				this.callbacks.onStartMatch?.(msg.mode, msg.seed, Boolean(msg.ranked));
				break;
			case "rankedResult":
				this.elo = msg.eloAfter;
				this.callbacks.onRankedResult?.(msg.eloBefore, msg.eloAfter, msg.delta);
				break;
			case "snapshot":
				this.callbacks.onSnapshot?.(msg.snapshot);
				break;
			case "inputFrame":
				this.callbacks.onInputFrame?.(msg.frame, msg.fromSlot);
				break;
			case "error":
				this.callbacks.onError?.(msg.message);
				break;
		}
	}
}
