#!/usr/bin/env node
/** E2E online: 2 klienty Playwright + headless roomServer. */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const WEB_PORT = 5199;
const MP_PORT = Number(process.env.IGNITE_E2E_MP_PORT ?? 8766);

const MIME = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".glb": "model/gltf-binary",
	".wasm": "application/wasm",
	".mp3": "audio/mpeg",
	".ttf": "font/ttf",
};

function serveStatic(port) {
	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			let p = (req.url ?? "/").split("?")[0];
			if (p === "/") p = "/index.html";
			const file = join(DIST, p);
			if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
				res.writeHead(404);
				res.end("404");
				return;
			}
			res.writeHead(200, {
				"Content-Type": MIME[extname(file)] ?? "application/octet-stream",
			});
			res.end(readFileSync(file));
		});
		server.listen(port, "127.0.0.1", () => resolve(server));
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

function startMpServer(port) {
	const proc = spawn("npx", ["vite-node", "server/roomServer.ts"], {
		cwd: ROOT,
		env: { ...process.env, IGNITE_MP_PORT: String(port) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	return proc;
}

async function readMatchLog(page) {
	return page.evaluate(
		() => localStorage.getItem("ignite-match-log") ?? "",
	);
}

const mpProc = startMpServer(MP_PORT);
await waitMpReady(MP_PORT);

const webServer = await serveStatic(WEB_PORT);
const mpAddr = `127.0.0.1:${MP_PORT}`;
const base = `http://127.0.0.1:${WEB_PORT}`;

const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch({
	headless: true,
	...(chromiumPath ? { executablePath: chromiumPath } : {}),
	args: [
		"--use-gl=angle",
		"--use-angle=swiftshader",
		"--disable-gpu-sandbox",
		"--no-sandbox",
	],
});

const context = await browser.newContext();
const hostPage = await context.newPage();
const guestPage = await context.newPage();

for (const page of [hostPage, guestPage]) {
	page.on("pageerror", (err) => {
		console.error(`[pageerror] ${err.message}`);
	});
}

console.info(`[E2E online] host → ${base}/?onlineRole=host&mp=${mpAddr}`);
await hostPage.goto(`${base}/?onlineRole=host&mp=${encodeURIComponent(mpAddr)}`, {
	waitUntil: "domcontentloaded",
	timeout: 90_000,
});

await hostPage.waitForFunction(
	() => window.__igniteE2e?.roomCode?.length >= 4,
	{ timeout: 90_000 },
);
const roomCode = await hostPage.evaluate(() => window.__igniteE2e?.roomCode ?? "");
console.info(`[E2E online] pokój: ${roomCode}`);

console.info(`[E2E online] guest → join ${roomCode}`);
await guestPage.goto(
	`${base}/?onlineRole=guest&mp=${encodeURIComponent(mpAddr)}&room=${roomCode}`,
	{ waitUntil: "domcontentloaded", timeout: 90_000 },
);

let hostLive = false;
let guestLive = false;

for (let i = 0; i < 120; i++) {
	await sleep(500);
	const [hostLog, guestLog] = await Promise.all([
		readMatchLog(hostPage),
		readMatchLog(guestPage),
	]);
	if (hostLog.includes("match live")) hostLive = true;
	if (guestLog.includes("match live")) guestLive = true;

	if (i % 6 === 0) {
		console.info(
			`[E2E online] t=${(i * 0.5).toFixed(0)}s hostLive=${hostLive} guestLive=${guestLive}`,
		);
	}

	const hostErr = await hostPage
		.evaluate(() => document.getElementById("error-msg")?.textContent ?? "")
		.catch(() => "");
	const guestErr = await guestPage
		.evaluate(() => document.getElementById("error-msg")?.textContent ?? "")
		.catch(() => "");
	if (hostErr || guestErr) {
		console.error("ERROR UI:", { hostErr, guestErr });
		break;
	}

	if (hostLive && guestLive) break;
}

console.info("\n=== host match log ===\n", await readMatchLog(hostPage));
console.info("\n=== guest match log ===\n", await readMatchLog(guestPage));

await browser.close();
webServer.close();
mpProc.kill("SIGTERM");

const ok = hostLive && guestLive;
console.info(ok ? "\nE2E online: PASS" : "\nE2E online: FAIL");
process.exit(ok ? 0 : 1);
