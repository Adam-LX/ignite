import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import type { GameModeId } from "../src/game/modes.ts";
import {
	DEFAULT_MP_PORT,
	PRE_MATCH_COUNTDOWN_MS,
	type ClientMessage,
	type LobbyStatePayload,
	type ServerMessage,
} from "../src/net/protocol.ts";
import type { PolicySyncPayload } from "../src/net/botPolicyProtocol.ts";
import {
	getGlobalPolicyState,
	mergePolicySyncFederated,
	policyPathForLogs,
} from "./globalBotPolicy.ts";
import { listWaitingRooms } from "./mpRooms.ts";
import {
	buildLobbyState,
	canRequestStart,
	nextFreeSlot,
	onlineMaxPlayers,
	resolveOnlineMode,
	sanitizeRankedFlag,
	type LobbyHuman,
} from "./roomLogic.ts";
import {
	applyRankedMatch,
	getLeaderboard,
	getRankedPlayer,
	rankedForfeitScores,
	rankedPathForLogs,
} from "./rankedElo.ts";

type RoomClient = {
	ws: WebSocket;
	slot: number;
	clientId: string;
	ready: boolean;
	displayName: string;
	carId: string;
};

type Room = {
	code: string;
	mode: GameModeId;
	maxPlayers: number;
	clients: RoomClient[];
	ranked: boolean;
	matchActive: boolean;
	matchReported: boolean;
};

const PORT = Number(process.env.IGNITE_MP_PORT ?? DEFAULT_MP_PORT);
const rooms = new Map<string, Room>();
const clientRoom = new WeakMap<WebSocket, Room>();

function send(ws: WebSocket, msg: ServerMessage): void {
	if (ws.readyState === ws.OPEN) {
		ws.send(JSON.stringify(msg));
	}
}

function generateRoomCode(): string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let code = "";
	for (let i = 0; i < 6; i++) {
		code += alphabet[Math.floor(Math.random() * alphabet.length)]!;
	}
	if (rooms.has(code)) return generateRoomCode();
	return code;
}

function findClient(room: Room, ws: WebSocket): RoomClient | null {
	return room.clients.find((c) => c.ws === ws) ?? null;
}

function broadcast(room: Room, msg: ServerMessage, except?: WebSocket): void {
	for (const client of room.clients) {
		if (client.ws !== except) send(client.ws, msg);
	}
}

function humansOf(room: Room): LobbyHuman[] {
	return room.clients.map((c) => ({
		slot: c.slot,
		clientId: c.clientId,
		displayName: c.displayName,
		carId: c.carId,
		ready: c.ready,
	}));
}

function lobbyPayload(room: Room): LobbyStatePayload {
	return buildLobbyState({
		mode: room.mode,
		maxPlayers: room.maxPlayers,
		humans: humansOf(room),
		ranked: room.ranked,
	});
}

function broadcastLobby(room: Room): void {
	broadcast(room, { type: "lobbyState", state: lobbyPayload(room) });
}

function destroyRoom(room: Room, reason?: string): void {
	rooms.delete(room.code);
	for (const client of room.clients) {
		clientRoom.delete(client.ws);
		send(client.ws, { type: "peerLeft", reason });
	}
}

function notifyRankedResult(
	room: Room,
	result: ReturnType<typeof applyRankedMatch>,
): void {
	const host = room.clients.find((c) => c.slot === 0);
	const guest = room.clients.find((c) => c.slot !== 0);
	if (!host) return;
	send(host.ws, {
		type: "rankedResult",
		eloBefore: result.host.elo - result.hostDelta,
		eloAfter: result.host.elo,
		delta: result.hostDelta,
	});
	if (guest) {
		send(guest.ws, {
			type: "rankedResult",
			eloBefore: result.guest.elo - result.guestDelta,
			eloAfter: result.guest.elo,
			delta: result.guestDelta,
		});
	}
}

function tryRankedForfeit(room: Room, loserSlot: number): void {
	if (!room.ranked || room.matchReported || room.clients.length < 2) return;
	const host = room.clients.find((c) => c.slot === 0);
	const opponent = room.clients.find((c) => c.slot !== 0);
	if (!host || !opponent) return;
	room.matchReported = true;
	room.matchActive = false;
	const scores = rankedForfeitScores(loserSlot, room.mode);
	const result = applyRankedMatch({
		hostClientId: host.clientId,
		guestClientId: opponent.clientId,
		...scores,
	});
	notifyRankedResult(room, result);
}

function beginMatch(room: Room): void {
	room.matchReported = false;
	room.matchActive = true;
	for (const c of room.clients) c.ready = false;
	const seed = Math.floor(Math.random() * 0x7fffffff);
	const lobby = lobbyPayload(room);
	const start: ServerMessage = {
		type: "startMatch",
		mode: room.mode,
		seed,
		ranked: room.ranked,
		lobby,
		preMatchEndsAtMs: Date.now() + PRE_MATCH_COUNTDOWN_MS,
	};
	broadcast(room, start);
}

function welcomeClient(room: Room, client: RoomClient): void {
	const elo = room.ranked ? getRankedPlayer(client.clientId).elo : undefined;
	send(client.ws, {
		type: "welcome",
		roomCode: room.code,
		slot: client.slot,
		role: client.slot === 0 ? "host" : "guest",
		ranked: room.ranked,
		elo,
		mode: room.mode,
	});
	send(client.ws, { type: "lobbyState", state: lobbyPayload(room) });
}

function handleMessage(ws: WebSocket, raw: string): void {
	let msg: ClientMessage;
	try {
		msg = JSON.parse(raw) as ClientMessage;
	} catch {
		send(ws, { type: "error", message: "Nieprawidłowy JSON" });
		return;
	}

	const room = clientRoom.get(ws);

	if (msg.type === "createRoom") {
		if (room) {
			send(ws, { type: "error", message: "Już jesteś w pokoju" });
			return;
		}
		const mode = resolveOnlineMode(msg.mode);
		const code = generateRoomCode();
		const clientId = msg.clientId?.trim() || `anon_${Date.now()}`;
		const ranked = sanitizeRankedFlag(Boolean(msg.ranked), mode);
		const host: RoomClient = {
			ws,
			slot: 0,
			clientId,
			ready: false,
			displayName: "Host",
			carId: "octane",
		};
		const newRoom: Room = {
			code,
			mode,
			maxPlayers: onlineMaxPlayers(mode),
			clients: [host],
			ranked,
			matchActive: false,
			matchReported: false,
		};
		rooms.set(code, newRoom);
		clientRoom.set(ws, newRoom);
		welcomeClient(newRoom, host);
		return;
	}

	if (msg.type === "joinRoom") {
		if (room) {
			send(ws, { type: "error", message: "Już jesteś w pokoju" });
			return;
		}
		const code = msg.roomCode.trim().toUpperCase();
		const target = rooms.get(code);
		if (!target) {
			send(ws, { type: "error", message: "Nie znaleziono pokoju" });
			return;
		}
		if (target.matchActive) {
			send(ws, { type: "error", message: "Mecz już trwa" });
			return;
		}
		if (target.clients.length >= target.maxPlayers) {
			send(ws, { type: "error", message: "Pokój jest pełny" });
			return;
		}
		const slot = nextFreeSlot(
			target.clients.map((c) => c.slot),
			target.maxPlayers,
		);
		if (slot === null) {
			send(ws, { type: "error", message: "Brak wolnych slotów" });
			return;
		}
		const clientId = msg.clientId?.trim() || `anon_${Date.now()}`;
		const guest: RoomClient = {
			ws,
			slot,
			clientId,
			ready: false,
			displayName: `Player ${slot + 1}`,
			carId: "octane",
		};
		target.clients.push(guest);
		clientRoom.set(ws, target);
		welcomeClient(target, guest);
		broadcast(target, { type: "peerJoined" }, ws);
		broadcastLobby(target);
		return;
	}

	if (!room) {
		send(ws, { type: "error", message: "Nie jesteś w pokoju" });
		return;
	}

	const client = findClient(room, ws);
	if (!client) return;
	const slot = client.slot;

	if (msg.type === "setReady") {
		if (room.matchActive) return;
		client.ready = Boolean(msg.ready);
		broadcastLobby(room);
		return;
	}

	if (msg.type === "setLoadout") {
		const carId = msg.carId?.trim();
		if (carId) client.carId = carId.slice(0, 48);
		const name = msg.displayName?.trim();
		if (name) client.displayName = name.slice(0, 24);
		broadcastLobby(room);
		return;
	}

	if (msg.type === "requestStart") {
		if (slot !== 0) {
			send(ws, { type: "error", message: "Tylko host może wystartować mecz" });
			return;
		}
		if (room.matchActive) {
			send(ws, { type: "error", message: "Mecz już trwa" });
			return;
		}
		const humans = humansOf(room);
		const allReady = humans.every((h) => h.ready);
		if (
			!canRequestStart({
				humanCount: humans.length,
				allReady,
				force: Boolean(msg.force),
				ranked: room.ranked,
			})
		) {
			send(ws, {
				type: "error",
				message: room.ranked
					? "Ranked wymaga 2 graczy i Ready (lub Start force)"
					: "Ustaw Ready lub użyj Start (force)",
			});
			return;
		}
		beginMatch(room);
		return;
	}

	if (msg.type === "reportMatch") {
		if (!room.ranked || room.clients.length < 2 || room.matchReported) return;
		if (slot !== 0) {
			send(ws, { type: "error", message: "Tylko host raportuje wynik ranked" });
			return;
		}
		const opponent = room.clients.find((c) => c.slot !== 0);
		if (!opponent) return;
		room.matchReported = true;
		room.matchActive = false;
		const result = applyRankedMatch({
			hostClientId: client.clientId,
			guestClientId: opponent.clientId,
			blueScore: msg.blueScore,
			orangeScore: msg.orangeScore,
		});
		notifyRankedResult(room, result);
		return;
	}

	if (msg.type === "rematch") {
		if (slot !== 0) {
			send(ws, { type: "error", message: "Tylko host może zlecić rematch" });
			return;
		}
		if (room.clients.length < 1) {
			send(ws, { type: "error", message: "Brak graczy w pokoju" });
			return;
		}
		if (room.ranked && room.clients.length < 2) {
			send(ws, { type: "error", message: "Ranked rematch wymaga 2 graczy" });
			return;
		}
		beginMatch(room);
		return;
	}

	if (msg.type === "forfeit") {
		if (room.clients.length < 2 || !room.matchActive) {
			send(ws, { type: "error", message: "Brak aktywnego meczu" });
			return;
		}
		const scores = rankedForfeitScores(slot, room.mode);
		tryRankedForfeit(room, slot);
		const payload: ServerMessage = {
			type: "matchForfeit",
			loserSlot: slot,
			...scores,
		};
		broadcast(room, payload);
		room.matchActive = false;
		return;
	}

	if (msg.type === "inputFrame") {
		broadcast(
			room,
			{
				type: "inputFrame",
				frame: msg.frame,
				fromSlot: slot,
			},
			ws,
		);
		return;
	}

	if (msg.type === "snapshot") {
		if (slot !== 0) {
			send(ws, { type: "error", message: "Tylko host może wysyłać snapshoty" });
			return;
		}
		broadcast(room, { type: "snapshot", snapshot: msg.snapshot }, ws);
		return;
	}

	if (msg.type === "goalReplayClip") {
		if (slot !== 0) {
			send(ws, {
				type: "error",
				message: "Tylko host może wysyłać goalReplayClip",
			});
			return;
		}
		broadcast(room, { type: "goalReplayClip", clip: msg.clip }, ws);
	}
}

function onDisconnect(ws: WebSocket): void {
	const room = clientRoom.get(ws);
	if (!room) return;
	const client = findClient(room, ws);
	if (!client) return;
	clientRoom.delete(ws);

	if (client.slot === 0) {
		tryRankedForfeit(room, 0);
		destroyRoom(room, "Host rozłączył się");
		return;
	}

	tryRankedForfeit(room, client.slot);
	room.clients = room.clients.filter((c) => c.ws !== ws);
	room.matchActive = false;
	broadcast(room, { type: "peerLeft", reason: "Gracz rozłączył się" });
	if (room.clients.length > 0) broadcastLobby(room);
}

function getServerStatus(wss: WebSocketServer) {
	let matches = 0;
	let waitingRooms = 0;
	let inMatchPlayers = 0;
	for (const room of rooms.values()) {
		if (room.matchActive) {
			matches++;
			inMatchPlayers += room.clients.length;
		} else if (room.clients.length < room.maxPlayers) {
			waitingRooms++;
		}
	}
	const policy = getGlobalPolicyState();
	return {
		playersOnline: wss.clients.size,
		inMatch: inMatchPlayers,
		matches,
		waitingRooms,
		rooms: rooms.size,
		botGeneration: policy.active.generation,
		botGlobalMatches: policy.totalMatches,
		rankedPlayers: getLeaderboard(50).length,
	};
}

function corsHeaders(): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	};
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		...corsHeaders(),
	});
	res.end(JSON.stringify(body));
}

async function handleHttp(
	req: IncomingMessage,
	res: ServerResponse,
	wss: WebSocketServer,
): Promise<void> {
	const url = req.url?.split("?")[0] ?? "/";

	if (req.method === "OPTIONS") {
		res.writeHead(204, corsHeaders());
		res.end();
		return;
	}

	if (url === "/status" && req.method === "GET") {
		jsonResponse(res, 200, getServerStatus(wss));
		return;
	}

	if (url === "/rooms" && req.method === "GET") {
		jsonResponse(res, 200, { rooms: listWaitingRooms(rooms.values()) });
		return;
	}

	if (url === "/policy" && req.method === "GET") {
		jsonResponse(res, 200, getGlobalPolicyState());
		return;
	}

	if (url === "/policy/sync" && req.method === "POST") {
		try {
			const raw = await readBody(req);
			const payload = JSON.parse(raw) as PolicySyncPayload;
			if (!payload?.active?.w1?.length) {
				jsonResponse(res, 400, { ok: false, error: "Brak active policy" });
				return;
			}
			const state = await mergePolicySyncFederated(payload);
			jsonResponse(res, 200, { ok: true, state, merged: true });
		} catch {
			jsonResponse(res, 400, { ok: false, error: "Nieprawidłowy JSON" });
		}
		return;
	}

	if (url === "/ranked/leaderboard" && req.method === "GET") {
		jsonResponse(res, 200, { players: getLeaderboard(20) });
		return;
	}

	if (url.startsWith("/ranked/player") && req.method === "GET") {
		const q = new URL(req.url ?? "/", "http://local").searchParams;
		const clientId = q.get("clientId")?.trim();
		if (!clientId) {
			jsonResponse(res, 400, { error: "Brak clientId" });
			return;
		}
		jsonResponse(res, 200, getRankedPlayer(clientId));
		return;
	}

	res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
	res.end(
		"Ignite multiplayer + global bot brain\n" +
			"GET /status · GET /rooms · GET /policy · POST /policy/sync\n" +
			"GET /ranked/leaderboard · GET /ranked/player?clientId=\n" +
			"Online: wszystkie tryby menu (max 8 slotów, bot-fill)\n",
	);
}

const httpServer = createServer((req, res) => {
	void handleHttp(req, res, wss);
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
	ws.on("message", (data) => {
		handleMessage(ws, data.toString());
	});
	ws.on("close", () => onDisconnect(ws));
	ws.on("error", () => onDisconnect(ws));
});

httpServer.listen(PORT, "0.0.0.0", () => {
	console.info(`[Ignite MP] Room server na ws://0.0.0.0:${PORT}`);
	console.info(`[Ignite MP] Global bot policy → ${policyPathForLogs()}`);
	console.info(`[Ignite MP] Ranked ELO → ${rankedPathForLogs()}`);
});
