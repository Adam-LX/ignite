import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import type { ClientMessage, ServerMessage } from "../../src/net/protocol";
import { startMpTestServer, stopMpTestServer } from "../helpers/mpTestServer";

const PORT = 18_700 + Math.floor(Math.random() * 200);

function connectWs(): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
		ws.once("open", () => resolve(ws));
		ws.once("error", reject);
	});
}

function send(ws: WebSocket, msg: ClientMessage): void {
	ws.send(JSON.stringify(msg));
}

function attachCollector(ws: WebSocket) {
	const messages: ServerMessage[] = [];
	ws.on("message", (raw) => {
		messages.push(JSON.parse(String(raw)) as ServerMessage);
	});

	const waitFor = (
		predicate: (msg: ServerMessage) => boolean,
		timeoutMs = 8000,
	): Promise<ServerMessage> =>
		new Promise((resolve, reject) => {
			const existing = messages.find(predicate);
			if (existing) {
				resolve(existing);
				return;
			}
			const timer = setTimeout(() => {
				ws.off("message", onMessage);
				reject(new Error("timeout waiting for WS message"));
			}, timeoutMs);
			const onMessage = (raw: WebSocket.RawData) => {
				const msg = JSON.parse(String(raw)) as ServerMessage;
				messages.push(msg);
				if (predicate(msg)) {
					clearTimeout(timer);
					ws.off("message", onMessage);
					resolve(msg);
				}
			};
			ws.on("message", onMessage);
		});

	return { messages, waitFor };
}

describe("room server online flow", () => {
	let proc: Awaited<ReturnType<typeof startMpTestServer>>;

	beforeAll(async () => {
		proc = await startMpTestServer(PORT);
	}, 30_000);

	afterAll(() => {
		stopMpTestServer(proc);
	});

	it("GET /ranked/leaderboard zwraca listę graczy", async () => {
		const res = await fetch(`http://127.0.0.1:${PORT}/ranked/leaderboard`);
		expect(res.ok).toBe(true);
		const body = (await res.json()) as { players: unknown[] };
		expect(Array.isArray(body.players)).toBe(true);
	});

	it("GET /ranked/player?clientId= zwraca profil", async () => {
		const id = `vitest_${randomUUID()}`;
		const res = await fetch(
			`http://127.0.0.1:${PORT}/ranked/player?clientId=${encodeURIComponent(id)}`,
		);
		expect(res.ok).toBe(true);
		const body = (await res.json()) as { clientId: string; elo: number };
		expect(body.clientId).toBe(id);
		expect(body.elo).toBeGreaterThan(0);
	});

	it("createRoom + joinRoom wysyła startMatch obu graczom", async () => {
		const host = await connectWs();
		const guest = await connectWs();
		const hostIn = attachCollector(host);
		const guestIn = attachCollector(guest);

		send(host, {
			type: "createRoom",
			ranked: false,
			clientId: `host_${randomUUID()}`,
		});
		const welcome = (await hostIn.waitFor((m) => m.type === "welcome")) as Extract<
			ServerMessage,
			{ type: "welcome" }
		>;

		send(guest, {
			type: "joinRoom",
			roomCode: welcome.roomCode,
			clientId: `guest_${randomUUID()}`,
		});

		const hostStart = (await hostIn.waitFor(
			(m) => m.type === "startMatch",
		)) as Extract<ServerMessage, { type: "startMatch" }>;
		const guestStart = (await guestIn.waitFor(
			(m) => m.type === "startMatch",
		)) as Extract<ServerMessage, { type: "startMatch" }>;

		expect(hostStart.mode).toBe("1v1");
		expect(guestStart.mode).toBe("1v1");
		expect(typeof hostStart.seed).toBe("number");

		host.close();
		guest.close();
	});

	it("ranked forfeit — gość rozłącza się, host dostaje rankedResult", async () => {
		const host = await connectWs();
		const guest = await connectWs();
		const hostIn = attachCollector(host);

		send(host, {
			type: "createRoom",
			ranked: true,
			clientId: `host_ff_${randomUUID()}`,
		});
		const welcome = (await hostIn.waitFor((m) => m.type === "welcome")) as Extract<
			ServerMessage,
			{ type: "welcome" }
		>;

		send(guest, {
			type: "joinRoom",
			roomCode: welcome.roomCode,
			clientId: `guest_ff_${randomUUID()}`,
		});
		await hostIn.waitFor((m) => m.type === "startMatch");

		await new Promise<void>((resolve) => {
			guest.once("close", () => resolve());
			guest.close();
		});

		const ranked = (await hostIn.waitFor(
			(m) => m.type === "rankedResult",
		)) as Extract<ServerMessage, { type: "rankedResult" }>;
		expect(ranked.delta).toBeGreaterThan(0);

		host.close();
	});

	it("rematch wysyła nowy startMatch z innym seedem", async () => {
		const host = await connectWs();
		const guest = await connectWs();
		const hostIn = attachCollector(host);
		const guestIn = attachCollector(guest);

		send(host, {
			type: "createRoom",
			ranked: false,
			clientId: `host_rm_${randomUUID()}`,
		});
		const welcome = (await hostIn.waitFor((m) => m.type === "welcome")) as Extract<
			ServerMessage,
			{ type: "welcome" }
		>;

		send(guest, {
			type: "joinRoom",
			roomCode: welcome.roomCode,
			clientId: `guest_rm_${randomUUID()}`,
		});

		const firstHost = (await hostIn.waitFor(
			(m) => m.type === "startMatch",
		)) as Extract<ServerMessage, { type: "startMatch" }>;
		await guestIn.waitFor((m) => m.type === "startMatch");

		send(host, { type: "rematch" });

		const secondHost = (await hostIn.waitFor(
			(m) => m.type === "startMatch" && m.seed !== firstHost.seed,
		)) as Extract<ServerMessage, { type: "startMatch" }>;
		const secondGuest = (await guestIn.waitFor(
			(m) => m.type === "startMatch" && m.seed === secondHost.seed,
		)) as Extract<ServerMessage, { type: "startMatch" }>;

		expect(secondGuest.seed).toBe(secondHost.seed);

		host.close();
		guest.close();
	});
});
