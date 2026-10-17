#!/usr/bin/env node
/**
 * Smoke: 2 klienty WS przez publiczny relay (createRoom → joinRoom → lobby).
 *
 *   IGNITE_MP_SERVER=wss://… node scripts/smoke-public-relay.mjs
 *   npm run test:e2e:public-relay:smoke
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function resolveRelay() {
	if (process.env.IGNITE_MP_SERVER?.trim()) {
		return process.env.IGNITE_MP_SERVER.trim();
	}
	const envPath = join(ROOT, "data/mp-public-endpoint.env");
	if (existsSync(envPath)) {
		const m = readFileSync(envPath, "utf8").match(
			/^IGNITE_MP_SERVER=(.+)$/m,
		);
		if (m?.[1]) return m[1].trim();
	}
	throw new Error("Brak IGNITE_MP_SERVER / data/mp-public-endpoint.env");
}

function connect(url) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const t = setTimeout(() => reject(new Error("WS connect timeout")), 20_000);
		ws.once("open", () => {
			clearTimeout(t);
			resolve(ws);
		});
		ws.once("error", (e) => {
			clearTimeout(t);
			reject(e);
		});
	});
}

function attach(ws) {
	const messages = [];
	ws.on("message", (raw) => {
		try {
			messages.push(JSON.parse(String(raw)));
		} catch {
			/* ignore */
		}
	});
	const waitFor = (pred, timeoutMs = 12_000) =>
		new Promise((resolve, reject) => {
			const hit = messages.find(pred);
			if (hit) {
				resolve(hit);
				return;
			}
			const timer = setTimeout(() => {
				ws.off("message", onMsg);
				reject(new Error(`timeout waiting: ${pred}`));
			}, timeoutMs);
			const onMsg = (raw) => {
				let msg;
				try {
					msg = JSON.parse(String(raw));
				} catch {
					return;
				}
				messages.push(msg);
				if (pred(msg)) {
					clearTimeout(timer);
					ws.off("message", onMsg);
					resolve(msg);
				}
			};
			ws.on("message", onMsg);
		});
	return { waitFor, messages };
}

function send(ws, msg) {
	ws.send(JSON.stringify(msg));
}

const url = resolveRelay();
console.info(`[relay-smoke] ${url}`);

const host = await connect(url);
const guest = await connect(url);
const hostIn = attach(host);
const guestIn = attach(guest);

send(host, {
	type: "createRoom",
	mode: "1v1",
	ranked: false,
	clientId: `smoke_host_${Date.now()}`,
});

const welcome = await hostIn.waitFor((m) => m.type === "welcome");
const code = welcome.roomCode ?? welcome.state?.code;
if (!code) {
	console.error("[relay-smoke] FAIL — brak roomCode w welcome", welcome);
	process.exit(1);
}
console.info(`[relay-smoke] room ${code}`);

send(guest, {
	type: "joinRoom",
	roomCode: code,
	clientId: `smoke_guest_${Date.now()}`,
});

const lobby = await hostIn.waitFor((m) => {
	if (m.type !== "lobbyState" || !Array.isArray(m.state?.slots)) return false;
	const humans = m.state.slots.filter((s) => s && s.isBot === false && s.peerId);
	return humans.length >= 2;
});

const fillBots = Boolean(lobby.state?.fillBots);
const humans = lobby.state.slots.filter((s) => s && s.isBot === false && s.peerId);
if (fillBots) {
	console.error("[relay-smoke] FAIL — fillBots powinno być false");
	process.exit(1);
}
if (humans.length < 2) {
	console.error("[relay-smoke] FAIL — oczekiwano ≥2 ludzi", lobby.state);
	process.exit(1);
}

console.info(
	`[relay-smoke] PASS — humans=${humans.length} fillBots=${fillBots} mode=${lobby.state?.mode}`,
);
host.close();
guest.close();
process.exit(0);
