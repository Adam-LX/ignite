#!/usr/bin/env node
/** E2E local 2v2: 4 klientów WS + headless roomServer, 60s bez rozłączenia. */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";

const ROOT = new URL("..", import.meta.url).pathname;
const MP_PORT = Number(process.env.IGNITE_E2E_MP_PORT ?? 8767);
const DURATION_MS = Number(process.env.IGNITE_E2E_2V2_SEC ?? 60) * 1000;

function startMpServer(port) {
	return spawn("npx", ["vite-node", "server/roomServer.ts"], {
		cwd: ROOT,
		env: { ...process.env, IGNITE_MP_PORT: String(port) },
		stdio: ["ignore", "pipe", "pipe"],
	});
}

async function waitMpReady(port, attempts = 50) {
	for (let i = 0; i < attempts; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/status`);
			if (res.ok) return;
		} catch {
			// retry
		}
		await sleep(150);
	}
	throw new Error(`MP server nie odpowiada na porcie ${port}`);
}

function connectWs(port) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
	});
}

function waitMessage(ws, type, timeoutMs = 8000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Timeout: ${type}`)), timeoutMs);
		const onMsg = (raw) => {
			try {
				const msg = JSON.parse(raw.toString());
				if (msg.type === type) {
					clearTimeout(timer);
					ws.off("message", onMsg);
					resolve(msg);
				}
			} catch {
				// ignore
			}
		};
		ws.on("message", onMsg);
	});
}

function send(ws, msg) {
	ws.send(JSON.stringify(msg));
}

const mpProc = startMpServer(MP_PORT);
await waitMpReady(MP_PORT);

let roomCode = "";
const clients = [];

try {
	const hostWs = await connectWs(MP_PORT);
	clients.push(hostWs);
	send(hostWs, { type: "createRoom", mode: "2v2", clientId: "e2e_host" });
	const welcome = await waitMessage(hostWs, "welcome");
	roomCode = welcome.roomCode;

	for (let i = 1; i < 4; i++) {
		const ws = await connectWs(MP_PORT);
		clients.push(ws);
		send(ws, {
			type: "joinRoom",
			roomCode,
			clientId: `e2e_guest_${i}`,
		});
		await waitMessage(ws, "welcome");
	}

	const startMatches = await Promise.all(
		clients.map((ws) => waitMessage(ws, "startMatch")),
	);
	if (startMatches.some((m) => m.mode !== "2v2")) {
		throw new Error("startMatch bez mode=2v2");
	}

	const host = clients[0];
	let tick = 0;
	const interval = setInterval(() => {
		tick++;
		send(host, {
			type: "snapshot",
			snapshot: {
				tick,
				serverTimeMs: Date.now(),
				ball: {
					pos: { x: 0, y: 1, z: 0 },
					quat: { x: 0, y: 0, z: 0, w: 1 },
					linvel: { x: 0, y: 0, z: 0 },
					angvel: { x: 0, y: 0, z: 0 },
				},
				cars: [0, 1, 2, 3].map((slot) => ({
					slot,
					pos: { x: 0, y: 1, z: slot * 2 },
					quat: { x: 0, y: 0, z: 0, w: 1 },
					linvel: { x: 0, y: 0, z: 0 },
					angvel: { x: 0, y: 0, z: 0 },
					boost: 0.5,
					boosting: false,
				})),
				match: {
					phase: "playing",
					timeRemainingSec: 300,
					blueScore: 0,
					orangeScore: 0,
					countdownSec: null,
					kickoffTick: null,
					kickoffIgnite: false,
					overtimeBanner: false,
					isOvertime: false,
					winnerLabel: null,
					replayActive: false,
					resetCountdown: null,
					goalScorerName: null,
				},
				playerStats: [],
			},
		});
		for (let i = 1; i < 4; i++) {
			send(clients[i], {
				type: "inputFrame",
				frame: {
					seq: tick,
					tickHint: tick,
					forward: 1,
					yaw: 0,
					roll: 0,
					boost: false,
					shift: false,
					jumpHeld: false,
					jumpEdge: false,
					recover: false,
				},
			});
		}
	}, 1000 / 20);

	await sleep(DURATION_MS);
	clearInterval(interval);

	for (const ws of clients) {
		if (ws.readyState !== WebSocket.OPEN) {
			throw new Error("Klient rozłączony przed końcem testu");
		}
	}

	console.info(
		`OK — 2v2 local E2E: 4 klientów, ${DURATION_MS / 1000}s, tick=${tick}`,
	);
} finally {
	for (const ws of clients) ws.close();
	mpProc.kill("SIGTERM");
}
