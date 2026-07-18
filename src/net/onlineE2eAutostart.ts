import type { GameModeId } from "../game/modes";
import type { OnlineLobbyResult } from "../ui/MultiplayerLobby";
import { NetworkControlInputPool } from "./NetworkControlInputPool";
import { RoomClient } from "./RoomClient";

export type OnlineE2eConfig = {
	role: "host" | "guest";
	mpAddress: string;
	roomCode?: string;
};

declare global {
	interface Window {
		__igniteE2e?: {
			roomCode: string;
			mp: string;
		};
	}
}

export function parseOnlineE2eParams(
	params: URLSearchParams,
): OnlineE2eConfig | null {
	const role = params.get("onlineRole");
	const mp = params.get("mp")?.trim();
	if ((role !== "host" && role !== "guest") || !mp) {
		return null;
	}
	return {
		role,
		mpAddress: mp,
		roomCode: params.get("room")?.trim().toUpperCase() || undefined,
	};
}

/** Autostart online dla Playwright E2E (?onlineRole=host|guest&mp=host:port). */
export async function runOnlineE2eAutostart(
	config: OnlineE2eConfig,
	onStart: (result: OnlineLobbyResult) => void,
): Promise<void> {
	const remoteInputs = new NetworkControlInputPool();
	const roomClient = new RoomClient();
	await roomClient.connect(config.mpAddress);

	const emit = (
		role: "host" | "guest",
		mode: GameModeId,
		lobby?: OnlineLobbyResult["lobby"],
		preMatchEndsAtMs?: number,
	) => {
		onStart({
			role,
			localSlot: roomClient.slot ?? (role === "host" ? 0 : 1),
			mode,
			roomClient,
			remoteInputs,
			roomCode: roomClient.roomCode ?? config.roomCode ?? "",
			ranked: roomClient.ranked,
			lobby,
			preMatchEndsAtMs,
		});
	};

	if (config.role === "guest") {
		if (!config.roomCode) {
			throw new Error("onlineRole=guest wymaga parametru ?room=KOD");
		}
		await new Promise<void>((resolve, reject) => {
			const timeout = window.setTimeout(
				() => reject(new Error("E2E guest: timeout startMatch")),
				90_000,
			);
			roomClient.setCallbacks({
				onStartMatch: (mode, _seed, _ranked, lobby, preMatchEndsAtMs) => {
					window.clearTimeout(timeout);
					emit("guest", mode, lobby, preMatchEndsAtMs);
					resolve();
				},
				onError: (message) => {
					window.clearTimeout(timeout);
					reject(new Error(message));
				},
			});
			roomClient.joinRoom(config.roomCode!);
		});
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const timeout = window.setTimeout(
			() => reject(new Error("E2E host: timeout startMatch")),
			90_000,
		);
		let started = false;
		const tryStart = () => {
			if (started) return;
			roomClient.setReady(true);
			roomClient.requestStart(true);
		};
		roomClient.setCallbacks({
			onWelcome: (roomCode) => {
				window.__igniteE2e = { roomCode, mp: config.mpAddress };
				roomClient.setReady(true);
			},
			onLobbyState: (state) => {
				const humans = state.slots.filter((s) => !s.isBot).length;
				if (humans >= 2) tryStart();
			},
			onPeerJoined: () => tryStart(),
			onStartMatch: (mode, _seed, _ranked, lobby, preMatchEndsAtMs) => {
				started = true;
				window.clearTimeout(timeout);
				emit("host", mode, lobby, preMatchEndsAtMs);
				resolve();
			},
			onError: (message) => {
				window.clearTimeout(timeout);
				reject(new Error(message));
			},
		});
		roomClient.createRoom(false, "1v1");
		window.setTimeout(() => tryStart(), 2500);
	});
}
