#!/usr/bin/env node
/** Autostart meczu + zrzut logów do momentu IGNITE / crash (Playwright + SwiftShader). */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const MODE = process.env.IGNITE_AUTOSTART ?? "1v1";
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

function serve(port) {
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

const port = 5198;
const server = await serve(port);
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
const page = await browser.newPage();

const logs = [];
page.on("console", (msg) => {
	const line = `[${msg.type()}] ${msg.text()}`;
	if (
		/\[Boot\]|\[Match\]|\[Ignite\]|error|crash|WebGL|uncaught/i.test(line)
	) {
		logs.push(line);
		console.log(line);
	}
});
page.on("pageerror", (err) => {
	const line = `[pageerror] ${err.message}\n${err.stack ?? ""}`;
	logs.push(line);
	console.error(line);
});
page.on("crash", () => {
	console.error("[CRASH] renderer process died");
});

const t0 = Date.now();
const el = (sec) => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

await page.goto(`http://127.0.0.1:${port}/?autostart=${MODE}`, {
	waitUntil: "domcontentloaded",
	timeout: 60_000,
});

let sawIgnite = false;
let sawLive = false;

for (let i = 0; i < 90; i++) {
	await page.waitForTimeout(500);
	const snap = await page
		.evaluate(() => ({
			kickoff: document.getElementById("kickoff-banner")?.textContent?.trim() ?? "",
			kickoffClass: document.getElementById("kickoff-banner")?.className ?? "",
			hudHidden: document.getElementById("hud")?.classList.contains("hidden"),
			error: document.getElementById("error-msg")?.textContent ?? "",
			boot: localStorage.getItem("ignite-boot-log") ?? "",
			match: localStorage.getItem("ignite-match-log") ?? "",
			glLost: document.querySelector("canvas")?.isConnected ?? false,
		}))
		.catch(() => null);

	if (!snap) {
		console.error(`${el()} page.evaluate failed — renderer gone?`);
		break;
	}

	if (snap.match.includes("match live")) sawLive = true;
	if (snap.kickoff.includes("IGN") || snap.kickoffClass.includes("kickoff-ignite")) {
		sawIgnite = true;
		console.log(`${el()} IGNITE banner: "${snap.kickoff}" classes=${snap.kickoffClass}`);
	}

	if (snap.error) {
		console.error(`${el()} ERROR UI:\n${snap.error}`);
		break;
	}

	if (i % 4 === 0) {
		console.log(
			`${el()} hud=${!snap.hudHidden} kickoff="${snap.kickoff}" live=${sawLive}`,
		);
	}

	if (sawIgnite && i > 20) {
		// 2.5s po IGNITE — sprawdź czy żyje
		await page.waitForTimeout(2500);
		const alive = await page.evaluate(() => document.body?.isConnected).catch(() => false);
		console.log(`${el()} post-IGNITE alive=${alive}`);
		if (!alive) console.error("Died after IGNITE");
		break;
	}
}

const final = await page
	.evaluate(() => ({
		boot: localStorage.getItem("ignite-boot-log") ?? "",
		match: localStorage.getItem("ignite-match-log") ?? "",
		kickoff: document.getElementById("kickoff-banner")?.textContent ?? "",
	}))
	.catch(() => ({ boot: "", match: "", kickoff: "" }));

console.log("\n=== ignite-boot-log ===\n", final.boot);
console.log("\n=== ignite-match-log ===\n", final.match);
console.log("\n=== kickoff ===", final.kickoff);

await browser.close();
server.close();
process.exit(sawIgnite && final.match.includes("match live") ? 0 : 1);
