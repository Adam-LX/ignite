#!/usr/bin/env node
/**
 * Actual live 1v1 capture: spawn nix electron + CDP screencast → ~/Wideo/ignite-LIVE-1v1-*.mp4
 * Nie zamykaj okna Ignite podczas nagrywania.
 */
import { spawn, spawnSync } from "node:child_process";
import {
	mkdirSync,
	writeFileSync,
	rmSync,
	readdirSync,
	existsSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const SECONDS = Number(process.env.IGNITE_CAPTURE_SEC || 95);
const PORT = Number(process.env.IGNITE_CDP_PORT || 9229);
const OUT = join(homedir(), "Wideo");
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const frameDir = join(OUT, `_live_frames_${stamp}`);
mkdirSync(frameDir, { recursive: true });
const dest = join(OUT, `ignite-LIVE-1v1-${stamp}.mp4`);

const viteOk = await fetch("http://127.0.0.1:5173/")
	.then((r) => r.ok)
	.catch(() => false);
if (!viteOk) {
	console.error("Brak Vite na :5173");
	process.exit(1);
}

console.log("spawn electron… (NIE ZAMYKAJ OKNA)");
const child = spawn(
	"nix",
	[
		"shell",
		"nixpkgs#electron",
		"-c",
		"electron",
		".",
		"--no-sandbox",
		"--class=Ignite",
		`--remote-debugging-port=${PORT}`,
	],
	{
		cwd: ROOT,
		env: {
			...process.env,
			IGNITE_DEV: "1",
			IGNITE_WINDOWED: "1",
			IGNITE_CAPTURE_LOCK: "1",
			IGNITE_VITE_URL:
				"http://127.0.0.1:5173/?autostart=1v1&skipIntro=1&graphics=high",
			ELECTRON_ENABLE_LOGGING: "1",
			ELECTRON_OZONE_PLATFORM_HINT: "auto",
		},
		stdio: ["ignore", "pipe", "pipe"],
		detached: false,
	},
);
child.stdout.on("data", (d) => process.stdout.write(d));
child.stderr.on("data", (d) => process.stderr.write(d));
child.on("exit", (code) => {
	console.error("electron exited", code);
});

async function waitCdp(ms = 120000) {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		try {
			const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
			if (r.ok) return;
		} catch {
			/* */
		}
		await new Promise((r) => setTimeout(r, 400));
	}
	throw new Error("CDP timeout");
}

try {
	await waitCdp();
	/** Poczekaj na boot/match zanim Playwright podepnie CDP (wcześniej zabijało okno). */
	const bootWait = Number(process.env.IGNITE_BOOT_WAIT_MS || 45000);
	console.log(`CDP up — wait ${bootWait}ms for match boot…`);
	await new Promise((r) => setTimeout(r, bootWait));
	if (child.exitCode != null) {
		throw new Error(`electron died during boot (code=${child.exitCode})`);
	}
	console.log("connect Playwright CDP");
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
	const context = browser.contexts()[0];
	let page =
		context.pages().find((p) => p.url().includes("5173")) ||
		context.pages()[0];
	for (let i = 0; i < 60 && !page?.url()?.includes("5173"); i++) {
		await new Promise((r) => setTimeout(r, 500));
		page =
			context.pages().find((p) => p.url().includes("5173")) ||
			context.pages()[0];
	}
	console.log("page", page?.url());

	const cdp = await context.newCDPSession(page);
	try {
		const { windowId } = await cdp.send("Browser.getWindowForTarget");
		await cdp.send("Browser.setWindowBounds", {
			windowId,
			bounds: { width: 1920, height: 1080, window: "normal" },
		});
	} catch (e) {
		console.warn("resize:", e.message);
	}

	await page.waitForFunction(
		() => (window.__igniteSession?.cars?.length ?? 0) >= 2,
		null,
		{ timeout: 180000 },
	);
	await page.evaluate(() => {
		document
			.querySelectorAll(
				"#error, .social-fab, #menu, #dev-free-cam-badge, #loading, #clip-rec-badge",
			)
			.forEach((el) => {
				el.style.display = "none";
			});
		const s = window.__igniteSession;
		s?.match?.setCountdownHold?.(false);
		s?.match?.forceStartPlaying?.();
		window.__igniteCaptureFreezePhysics = false;
		window.__igniteCaptureCamLock = false;
		window.__igniteFreeCam?.setActive?.(false);
	});
	await page.waitForTimeout(1500);

	let frameIdx = 0;
	let bytes = 0;
	cdp.on("Page.screencastFrame", async (params) => {
		const i = frameIdx++;
		const buf = Buffer.from(params.data, "base64");
		bytes += buf.length;
		writeFileSync(
			join(frameDir, `f_${String(i).padStart(6, "0")}.jpg`),
			buf,
		);
		try {
			await cdp.send("Page.screencastFrameAck", {
				sessionId: params.sessionId,
			});
		} catch {
			/* */
		}
	});

	await cdp.send("Page.startScreencast", {
		format: "jpeg",
		quality: 85,
		maxWidth: 1920,
		maxHeight: 1080,
		everyNthFrame: 1,
	});

	console.log(`recording LIVE ${SECONDS}s — leave Ignite open`);
	for (let t = 0; t < SECONDS * 1000; t += 5000) {
		await page.waitForTimeout(5000);
		const info = await page.evaluate(() => {
			const s = window.__igniteSession;
			const m = s?.match;
			const v = s?.cars?.[0]?.player?.rapierRigidBody?.linvel?.();
			return {
				phase: m?.phase ?? m?.state,
				score: m?.score,
				speed: v ? Math.hypot(v.x, v.y, v.z).toFixed(1) : null,
			};
		});
		console.log(
			`  +${(t + 5000) / 1000}s frames=${frameIdx} MB=${(bytes / 1e6).toFixed(1)}`,
			info,
		);
	}

	try {
		await cdp.send("Page.stopScreencast");
	} catch {
		/* */
	}
	await browser.close();
} finally {
	try {
		process.kill(-child.pid, "SIGTERM");
	} catch {
		try {
			child.kill("SIGTERM");
		} catch {
			/* */
		}
	}
}

const n = readdirSync(frameDir).filter((f) => f.endsWith(".jpg")).length;
const fps = Math.max(1, Math.round(n / SECONDS));
console.log(`frames=${n} encode_fps=${fps}`);
if (n < 80) {
	console.error("za mało klatek");
	process.exit(1);
}

const mid = join(
	frameDir,
	`f_${String(Math.floor(n / 2)).padStart(6, "0")}.jpg`,
);
spawnSync(
	"ffmpeg",
	[
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		mid,
		"-vf",
		"scale=64:36,format=gray",
		"-f",
		"rawvideo",
		"/tmp/live-mid.gray",
	],
	{ stdio: "inherit" },
);
const g = readFileSync("/tmp/live-mid.gray");
const mean = [...g].reduce((a, b) => a + b, 0) / g.length;
console.log("mid luminance", mean.toFixed(1));
if (mean < 12) {
	console.error("BLACK");
	process.exit(1);
}

const enc = spawnSync(
	"ffmpeg",
	[
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-framerate",
		String(fps),
		"-i",
		join(frameDir, "f_%06d.jpg"),
		"-vf",
		"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"18",
		"-movflags",
		"+faststart",
		"-an",
		dest,
	],
	{ stdio: "inherit" },
);
if (enc.status !== 0 || !existsSync(dest)) {
	console.error("ffmpeg fail");
	process.exit(1);
}
console.log("SAVED", dest);
rmSync(frameDir, { recursive: true, force: true });
console.log(dest);
