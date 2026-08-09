#!/usr/bin/env node
/**
 * Live 1v1 bot match capture → ~/Wideo/ignite-gameplay-live-*.mp4
 * CDP Page.startScreencast → JPEG frames → system ffmpeg
 * (Playwright recordVideo needs missing nix ffmpeg-1010; canvas
 * MediaRecorder+SwiftShader produced empty webm).
 *
 *   node scripts/capture-gameplay-live.mjs
 */
import {
	mkdirSync,
	writeFileSync,
	existsSync,
	rmSync,
	readdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const OUT = join(homedir(), "Wideo");
mkdirSync(OUT, { recursive: true });
const BASE = (process.env.IGNITE_VITE_URL || "http://127.0.0.1:5173").replace(
	/\?.*$/,
	"",
);
const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.CHROME_PATH ??
	"/run/current-system/sw/bin/chromium";
const SECONDS = Number(process.env.IGNITE_CAPTURE_SEC || 95);
const FPS = Number(process.env.IGNITE_CAPTURE_FPS || 24);
const W = 1280;
const H = 720;

const health = await fetch(BASE)
	.then((r) => r.ok)
	.catch(() => false);
if (!health) {
	console.error(`Brak Vite na ${BASE}`);
	process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const frameDir = join(OUT, `_frames_${stamp}`);
mkdirSync(frameDir, { recursive: true });
const destMp4 = join(OUT, `ignite-gameplay-live-${stamp}.mp4`);

console.log("launch chromium", CHROMIUM);
const browser = await chromium.launch({
	headless: true,
	executablePath: CHROMIUM,
	args: [
		"--use-gl=angle",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
		"--no-sandbox",
		"--disable-dev-shm-usage",
		"--ignore-gpu-blocklist",
		"--autoplay-policy=no-user-gesture-required",
	],
});

const context = await browser.newContext({
	viewport: { width: W, height: H },
	deviceScaleFactor: 1,
});
const page = await context.newPage();
await page.addInitScript(() => {
	try {
		localStorage.setItem("ignite.seenBootCinematic.v1", "1");
		localStorage.setItem("ignite.graphicsQuality", "medium");
	} catch {
		/* */
	}
});

const url = `${BASE}/?autostart=1v1&skipIntro=1&graphics=medium&t=${Date.now()}`;
console.log("goto", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

try {
	await page.waitForFunction(
		() => (window.__igniteSession?.cars?.length ?? 0) >= 2,
		null,
		{ timeout: 180_000 },
	);
} catch (err) {
	console.error("NO SESSION", err.message);
	await context.close();
	await browser.close();
	process.exit(1);
}

await page.evaluate(() => {
	const hide = (sel) => {
		document.querySelectorAll(sel).forEach((el) => {
			el.style.display = "none";
		});
	};
	hide(
		"#error, .social-fab, #menu, #dev-free-cam-badge, #clip-rec-badge, #loading",
	);
	const s = window.__igniteSession;
	s?.match?.setCountdownHold?.(false);
	s?.match?.forceStartPlaying?.();
	window.__igniteFreeCam?.setActive?.(false);
	window.__igniteCaptureFreezePhysics = false;
	window.__igniteCaptureCamLock = false;
});

// Warm one paint
await page.waitForTimeout(1500);

const cdp = await context.newCDPSession(page);
let frameIdx = 0;
let lastAck = 0;
const onFrame = async (params) => {
	const i = frameIdx++;
	const path = join(frameDir, `f_${String(i).padStart(6, "0")}.jpg`);
	writeFileSync(path, Buffer.from(params.data, "base64"));
	lastAck = params.sessionId;
	try {
		await cdp.send("Page.screencastFrameAck", {
			sessionId: params.sessionId,
		});
	} catch {
		/* closed */
	}
};
cdp.on("Page.screencastFrame", onFrame);

await cdp.send("Page.startScreencast", {
	format: "jpeg",
	quality: 85,
	maxWidth: W,
	maxHeight: H,
	everyNthFrame: 1,
});

console.log(`CDP screencast ${SECONDS}s @ ~${FPS}fps target…`);
const t0 = Date.now();
const step = 5000;
for (let t = 0; t < SECONDS * 1000; t += step) {
	await page.waitForTimeout(step);
	const info = await page.evaluate(() => {
		const s = window.__igniteSession;
		const m = s?.match;
		return {
			cars: s?.cars?.length ?? 0,
			score: m?.score ?? null,
			phase: m?.phase ?? m?.state ?? null,
		};
	});
	console.log(
		`  +${(t + step) / 1000}s frames=${frameIdx} lastAck=${lastAck}`,
		info,
	);
}

try {
	await cdp.send("Page.stopScreencast");
} catch {
	/* */
}
await page.waitForTimeout(300);
await context.close();
await browser.close();

const n = readdirSync(frameDir).filter((f) => f.endsWith(".jpg")).length;
const elapsed = (Date.now() - t0) / 1000;
const realFps = Math.max(1, Math.round(n / Math.max(1, SECONDS)));
console.log(`frames=${n} wall=${elapsed.toFixed(1)}s encode_fps=${realFps}`);

if (n < 30) {
	console.error("za mało klatek");
	process.exit(1);
}

const mp4 = spawnSync(
	"ffmpeg",
	[
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-framerate",
		String(realFps),
		"-i",
		join(frameDir, "f_%06d.jpg"),
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-preset",
		"fast",
		"-crf",
		"20",
		"-movflags",
		"+faststart",
		"-an",
		destMp4,
	],
	{ stdio: "inherit" },
);
if (mp4.status !== 0 || !existsSync(destMp4)) {
	console.error("ffmpeg fail");
	process.exit(1);
}
console.log("SAVED", destMp4);
try {
	rmSync(frameDir, { recursive: true, force: true });
} catch {
	/* keep frames on failure path only */
}
