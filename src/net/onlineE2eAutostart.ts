import type { OnlineLobbyResult } from "../ui/MultiplayerLobby";
import { NetworkControlInput } from "./NetworkControlInput";
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

/** Autostart online 1v1 dla Playwright E2E (?onlineRole=host|guest&mp=host:port). */
export async function runOnlineE2eAutostart(
	config: OnlineE2eConfig,
	onStart: (result: OnlineLobbyResult) => void,
): Promise<void> {
	const remoteInput = new NetworkControlInput();
	const roomClient = new RoomClient();
	await roomClient.connect(config.mpAddress);

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
				onStartMatch: () => {
					window.clearTimeout(timeout);
					onStart({
						role: "guest",
						localSlot: roomClient.slot ?? 1,
						roomClient,
						remoteInput,
						roomCode: roomClient.roomCode ?? config.roomCode!,
						ranked: roomClient.ranked,
					});
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
		roomClient.setCallbacks({
			onWelcome: (roomCode) => {
				window.__igniteE2e = { roomCode, mp: config.mpAddress };
			},
			onStartMatch: () => {
				window.clearTimeout(timeout);
				onStart({
					role: "host",
					localSlot: roomClient.slot ?? 0,
					roomClient,
					remoteInput,
					roomCode: roomClient.roomCode ?? "",
					ranked: roomClient.ranked,
				});
				resolve();
			},
			onError: (message) => {
				window.clearTimeout(timeout);
				reject(new Error(message));
			},
		});
		roomClient.createRoom(false);
	});
}
