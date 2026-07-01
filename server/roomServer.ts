import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import {
	DEFAULT_MP_PORT,
	type ClientMessage,
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
	applyRankedMatch,
	getLeaderboard,
	getRankedPlayer,
	rankedForfeitScores,
	rankedPathForLogs,
} from "./rankedElo.ts";

type ClientSlot = 0 | 1;

type RoomClient = {
	ws: WebSocket;
	slot: ClientSlot;
	clientId: string;
};

type Room = {
	code: string;
	host: RoomClient;
	guest: RoomClient | null;
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

function destroyRoom(room: Room, reason?: string): void {
	rooms.delete(room.code);
	for (const peer of [room.host, room.guest]) {
		if (!peer) continue;
		clientRoom.delete(peer.ws);
		send(peer.ws, { type: "peerLeft", reason });
	}
}

function notifyRankedResult(
	room: Room,
	result: ReturnType<typeof applyRankedMatch>,
): void {
	send(room.host.ws, {
		type: "rankedResult",
		eloBefore: result.host.elo - result.hostDelta,
		eloAfter: result.host.elo,
		delta: result.hostDelta,
	});
	if (room.guest) {
		send(room.guest.ws, {
			type: "rankedResult",
			eloBefore: result.guest.elo - result.guestDelta,
			eloAfter: result.guest.elo,
			delta: result.guestDelta,
		});
	}
}

function tryRankedForfeit(room: Room, loserSlot: ClientSlot): void {
	if (!room.ranked || room.matchReported || !room.guest) return;
	room.matchReported = true;
	room.matchActive = false;
	const scores = rankedForfeitScores(loserSlot);
	const result = applyRankedMatch({
		hostClientId: room.host.clientId,
		guestClientId: room.guest.clientId,
		...scores,
	});
	notifyRankedResult(room, result);
}

function beginMatch(room: Room): void {
	room.matchReported = false;
	room.matchActive = true;
	const seed = Math.floor(Math.random() * 0x7fffffff);
	const start: ServerMessage = {
		type: "startMatch",
		mode: "1v1",
		seed,
		ranked: room.ranked,
	};
	send(room.host.ws, start);
	if (room.guest) send(room.guest.ws, start);
}

function relayToPeer(room: Room, from: ClientSlot, msg: ServerMessage): void {
	const target = from === 0 ? room.guest : room.host;
	if (target) send(target.ws, msg);
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
		const code = generateRoomCode();
		const clientId = msg.clientId?.trim() || `anon_${Date.now()}`;
		const ranked = Boolean(msg.ranked);
		const host: RoomClient = { ws, slot: 0, clientId };
		const newRoom: Room = {
			code,
			host,
			guest: null,
			ranked,
			matchActive: false,
			matchReported: false,
		};
		rooms.set(code, newRoom);
		clientRoom.set(ws, newRoom);
		const elo = ranked ? getRankedPlayer(clientId).elo : undefined;
		send(ws, {
			type: "welcome",
			roomCode: code,
			slot: 0,
			role: "host",
			ranked,
			elo,
		});
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
		if (target.guest) {
			send(ws, { type: "error", message: "Pokój jest pełny" });
			return;
		}
		const clientId = msg.clientId?.trim() || `anon_${Date.now()}`;
		const guest: RoomClient = { ws, slot: 1, clientId };
		target.guest = guest;
		clientRoom.set(ws, target);
		const hostElo = target.ranked
			? getRankedPlayer(target.host.clientId).elo
			: undefined;
		const guestElo = target.ranked ? getRankedPlayer(clientId).elo : undefined;
		send(ws, {
			type: "welcome",
			roomCode: code,
			slot: 1,
			role: "guest",
			ranked: target.ranked,
			elo: guestElo,
		});
		send(target.host.ws, {
			type: "welcome",
			roomCode: code,
			slot: 0,
			role: "host",
			ranked: target.ranked,
			elo: hostElo,
		});
		send(target.host.ws, { type: "peerJoined" });

		beginMatch(target);
		return;
	}

	if (!room) {
		send(ws, { type: "error", message: "Nie jesteś w pokoju" });
		return;
	}

	const slot = room.host.ws === ws ? 0 : room.guest?.ws === ws ? 1 : null;
	if (slot === null) return;

	if (msg.type === "reportMatch") {
		if (!room?.ranked || !room.guest || room.matchReported) return;
		if (slot !== 0) {
			send(ws, { type: "error", message: "Tylko host raportuje wynik ranked" });
			return;
		}
		room.matchReported = true;
		room.matchActive = false;
		const result = applyRankedMatch({
			hostClientId: room.host.clientId,
			guestClientId: room.guest.clientId,
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
		if (!room.guest) {
			send(ws, { type: "error", message: "Brak przeciwnika w pokoju" });
			return;
		}
		beginMatch(room);
		return;
	}

	if (msg.type === "inputFrame") {
		relayToPeer(room, slot, {
			type: "inputFrame",
			frame: msg.frame,
			fromSlot: slot,
		});
		return;
	}

	if (msg.type === "snapshot") {
		if (slot !== 0) {
			send(ws, { type: "error", message: "Tylko host może wysyłać snapshoty" });
			return;
		}
		relayToPeer(room, 0, { type: "snapshot", snapshot: msg.snapshot });
	}
}

function onDisconnect(ws: WebSocket): void {
	const room = clientRoom.get(ws);
	if (!room) return;
	clientRoom.delete(ws);

	if (room.host.ws === ws) {
		if (room.guest) {
			tryRankedForfeit(room, 0);
		}
		destroyRoom(room, "Host rozłączył się");
		return;
	}

	if (room.guest?.ws === ws) {
		tryRankedForfeit(room, 1);
		room.guest = null;
		room.matchActive = false;
		send(room.host.ws, { type: "peerLeft", reason: "Gość rozłączył się" });
	}
}

function getServerStatus(wss: WebSocketServer) {
	let matches = 0;
	let waitingRooms = 0;
	for (const room of rooms.values()) {
		if (room.guest) matches++;
		else waitingRooms++;
	}
	const policy = getGlobalPolicyState();
	return {
		playersOnline: wss.clients.size,
		inMatch: matches * 2,
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

async function handleHttp(req: IncomingMessage, res: ServerResponse, wss: WebSocketServer): Promise<void> {
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
			"GET /ranked/leaderboard · GET /ranked/player?clientId=\n",
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
