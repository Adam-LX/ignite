import type { GoalReplayClipPayload } from "../game/InputReplay";
import type { GameModeId } from "../game/modes";
import type GameInput from "../util/GameInput";
import { getMpClientId } from "./mpClientId";
import type {
	ClientMessage,
	InputFramePayload,
	LobbyStatePayload,
	OnlineRole,
	ServerMessage,
	WorldSnapshotPayload,
} from "./protocol";
import { resolveWsUrl } from "./protocol";
import { effectiveRanked } from "./rankedFeature";

export type RoomClientCallbacks = {
	onWelcome?: (
		roomCode: string,
		slot: number,
		role: OnlineRole,
		ranked: boolean,
		elo?: number,
		mode?: GameModeId,
	) => void;
	onPeerJoined?: () => void;
	onPeerLeft?: (reason?: string) => void;
	onLobbyState?: (state: LobbyStatePayload) => void;
	onStartMatch?: (
		mode: GameModeId,
		seed: number,
		ranked: boolean,
		lobby?: LobbyStatePayload,
		preMatchEndsAtMs?: number,
	) => void;
	onRankedResult?: (eloBefore: number, eloAfter: number, delta: number) => void;
	onMatchForfeit?: (
		loserSlot: number,
		blueScore: number,
		orangeScore: number,
	) => void;
	onSnapshot?: (snapshot: WorldSnapshotPayload) => void;
	onGoalReplayClip?: (clip: GoalReplayClipPayload) => void;
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
	private _mode: GameModeId | null = null;
	private _lobby: LobbyStatePayload | null = null;
	roomCode: string | null = null;
	slot: number | null = null;
	elo: number | null = null;
	/** Ostatni startMatch — human sloty + bot loadout. */
	lastStartLobby: LobbyStatePayload | null = null;
	lastPreMatchEndsAtMs: number | null = null;

	get role(): OnlineRole | null {
		return this._role;
	}

	get ranked(): boolean {
		return effectiveRanked(this._ranked);
	}

	get mode(): GameModeId | null {
		return this._mode;
	}

	get lobby(): LobbyStatePayload | null {
		return this._lobby;
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

	createRoom(ranked = false, mode?: GameModeId): void {
		this._ranked = effectiveRanked(ranked);
		this.send({
			type: "createRoom",
			ranked: this._ranked,
			mode,
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

	setReady(ready: boolean): void {
		this.send({ type: "setReady", ready });
	}

	setLoadout(carId: string, displayName?: string): void {
		this.send({ type: "setLoadout", carId, displayName });
	}

	requestStart(force = true): void {
		this.send({ type: "requestStart", force });
	}

	reportMatch(blueScore: number, orangeScore: number): void {
		this.send({ type: "reportMatch", blueScore, orangeScore });
	}

	requestRematch(): void {
		this.send({ type: "rematch" });
	}

	sendForfeit(): void {
		this.send({ type: "forfeit" });
	}

	sendSnapshot(snapshot: WorldSnapshotPayload): void {
		this.send({ type: "snapshot", snapshot });
	}

	sendGoalReplayClip(clip: GoalReplayClipPayload): void {
		this.send({ type: "goalReplayClip", clip });
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
			shift: input.isShiftDown(),
			jumpHeld: input.isJumpHeld(),
			jumpEdge,
			recover,
		};
		this.send({ type: "inputFrame", frame });
	}

	/** Sloty zajęte przez ludzi (nie boty) — z ostatniego startMatch/lobby. */
	humanSlots(): Set<number> {
		const lobby = this.lastStartLobby ?? this._lobby;
		const set = new Set<number>();
		if (!lobby) {
			if (this.slot != null) set.add(this.slot);
			return set;
		}
		for (const s of lobby.slots) {
			if (!s.isBot) set.add(s.slot);
		}
		return set;
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
				if (msg.mode) this._mode = msg.mode;
				this.callbacks.onWelcome?.(
					msg.roomCode,
					msg.slot,
					msg.role,
					Boolean(msg.ranked),
					msg.elo,
					msg.mode,
				);
				break;
			case "peerJoined":
				this.callbacks.onPeerJoined?.();
				break;
			case "peerLeft":
				this.callbacks.onPeerLeft?.(msg.reason);
				break;
			case "lobbyState":
				this._lobby = msg.state;
				this._mode = msg.state.mode;
				this.callbacks.onLobbyState?.(msg.state);
				break;
			case "startMatch":
				this._ranked = Boolean(msg.ranked);
				this._mode = msg.mode;
				if (msg.lobby) {
					this.lastStartLobby = msg.lobby;
					this._lobby = msg.lobby;
				}
				this.lastPreMatchEndsAtMs = msg.preMatchEndsAtMs ?? null;
				this.callbacks.onStartMatch?.(
					msg.mode,
					msg.seed,
					Boolean(msg.ranked),
					msg.lobby,
					msg.preMatchEndsAtMs,
				);
				break;
			case "rankedResult":
				this.elo = msg.eloAfter;
				this.callbacks.onRankedResult?.(msg.eloBefore, msg.eloAfter, msg.delta);
				break;
			case "matchForfeit":
				this.callbacks.onMatchForfeit?.(
					msg.loserSlot,
					msg.blueScore,
					msg.orangeScore,
				);
				break;
			case "snapshot":
				this.callbacks.onSnapshot?.(msg.snapshot);
				break;
			case "goalReplayClip":
				this.callbacks.onGoalReplayClip?.(msg.clip);
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
