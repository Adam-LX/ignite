#!/usr/bin/env node
/**
 * Dynamic LIVE 1v1 capture — boost / aerial / dodge / air-roll choreography
 * via autopilot + jumps, CDP screencast → ~/Wideo/ignite-DYNAMIC-*.mp4
 *
 *   IGNITE_CAPTURE_SEC=75 node scripts/capture-dynamic-gameplay.mjs
 *
 * NIE ZAMYKAJ okna Ignite podczas nagrywania.
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
const SECONDS = Number(process.env.IGNITE_CAPTURE_SEC || 75);
const BOOT_WAIT = Number(process.env.IGNITE_BOOT_WAIT_MS || 40000);
const PORT = Number(process.env.IGNITE_CDP_PORT || 9229);
const OUT = join(homedir(), "Wideo");
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const frameDir = join(OUT, `_dyn_frames_${stamp}`);
mkdirSync(frameDir, { recursive: true });
const dest = join(OUT, `ignite-DYNAMIC-1v1-${stamp}.mp4`);

const viteOk = await fetch("http://127.0.0.1:5173/")
	.then((r) => r.ok)
	.catch(() => false);
if (!viteOk) {
	console.error("Brak Vite na :5173");
	process.exit(1);
}

console.log("spawn electron (dynamic capture) — NIE ZAMYKAJ OKNA");
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
		},
		stdio: ["ignore", "pipe", "pipe"],
	},
);
child.stdout.on("data", (d) => process.stdout.write(d));
child.stderr.on("data", (d) => process.stderr.write(d));

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

function killElectron() {
	try {
		child.kill("SIGTERM");
	} catch {
		/* */
	}
	spawnSync("pkill", ["-x", "electron"], { stdio: "ignore" });
}

try {
	await waitCdp();
	console.log(`CDP up — boot wait ${BOOT_WAIT}ms`);
	await new Promise((r) => setTimeout(r, BOOT_WAIT));
	if (child.exitCode != null) {
		throw new Error(`electron died (code=${child.exitCode})`);
	}

	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
	const context = browser.contexts()[0];
	const page =
		context.pages().find((p) => p.url().includes("5173")) ||
		context.pages()[0];
	console.log("page", page.url());

	const cdp = await context.newCDPSession(page);
	await page.waitForFunction(
		() => (window.__igniteSession?.cars?.length ?? 0) >= 2,
		null,
		{ timeout: 120000 },
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

	/**
	 * Smooth chase — ZERO teleportów. Tylko autopilot w stronę piłki + boost
	 * + okazjonalny jump/dodge gdy blisko / piłka w powietrzu. Fizyka ciągła.
	 */
	await page.evaluate(() => {
		const input = window.__igniteMatchDeps?.humanInput;
		if (!input) {
			console.error("no humanInput");
			return;
		}
		let lastJumpAt = 0;
		let airRollDir = 0;

		const fillBoost = () => {
			for (const c of window.__igniteSession?.cars ?? []) {
				const p = c?.player ?? c;
				if (p && typeof p.boostFuel === "number") p.boostFuel = 1;
			}
		};

		const yawOf = (player) => {
			const q = player?.rapierRigidBody?.rotation?.();
			if (!q) return 0;
			/** yaw z quaternion (YXZ-ish). */
			const siny = 2 * (q.w * q.y + q.x * q.z);
			const cosy = 1 - 2 * (q.y * q.y + q.x * q.x);
			return Math.atan2(siny, cosy);
		};

		const tick = () => {
			if (!window.__igniteDynCapture) return;
			fillBoost();
			const s = window.__igniteSession;
			const human = s?.cars?.[0]?.player ?? s?.cars?.[0];
			const ball = window.__igniteBall;
			const ht = human?.rapierRigidBody?.translation?.();
			const bt = ball?.rapierRigidBody?.translation?.();
			if (!ht || !bt || !input) {
				requestAnimationFrame(tick);
				return;
			}

			const dx = bt.x - ht.x;
			const dz = bt.z - ht.z;
			const dy = bt.y - ht.y;
			const dist = Math.hypot(dx, dz) || 1;
			const wantYaw = Math.atan2(dx, dz);
			let yawErr = wantYaw - yawOf(human);
			while (yawErr > Math.PI) yawErr -= Math.PI * 2;
			while (yawErr < -Math.PI) yawErr += Math.PI * 2;
			const yawCmd = Math.max(-1, Math.min(1, yawErr * 1.8));

			const airborne = ht.y > 1.2;
			const ballAir = bt.y > 3.5;
			const close = dist < 9;
			const now = performance.now();

			/** Boost zawsze w pościgu; w powietrzu też. */
			input.setAutopilotDrive({
				forward: 1,
				yaw: yawCmd,
				boost: true,
			});

			/** Air roll tylko gdy już w powietrzu — przez prywatne flagi Q/E. */
			if (airborne) {
				if (airRollDir === 0) airRollDir = Math.random() < 0.5 ? -1 : 1;
				if (input.inputs) {
					input.inputs.q = airRollDir < 0;
					input.inputs.e = airRollDir > 0;
				}
			} else {
				airRollDir = 0;
				if (input.inputs) {
					input.inputs.q = false;
					input.inputs.e = false;
				}
			}

			/** Jump / dodge — cooldown, bez resetu pozycji. */
			if (now - lastJumpAt > 1600) {
				if ((!airborne && close && ballAir) || (!airborne && close && dist < 5)) {
					input.queueJump?.();
					lastJumpAt = now;
				} else if (airborne && close && now - lastJumpAt > 900) {
					/** drugi skok = dodge w powietrzu */
					input.queueJump?.();
					lastJumpAt = now;
				} else if (!airborne && dy > 2.5 && dist < 18) {
					input.queueJump?.();
					lastJumpAt = now;
				}
			}

			requestAnimationFrame(tick);
		};

		/** Muzyka OFF — zostaje SFX. */
		const audio = window.__igniteMatchDeps?.audio;
		if (audio) {
			audio.musicMuted = true;
			try {
				audio.matchMusic?.setVolume?.(0);
			} catch {
				/* */
			}
		}

		window.__igniteDynCapture = true;
		requestAnimationFrame(tick);
		console.log("[dyn] smooth chase armed (no teleports)");
	});

	await page.waitForTimeout(800);

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

	console.log(`recording DYNAMIC ${SECONDS}s`);
	for (let t = 0; t < SECONDS * 1000; t += 5000) {
		await page.waitForTimeout(5000);
		const info = await page.evaluate(() => {
			const s = window.__igniteSession;
			const p = s?.cars?.[0]?.player ?? s?.cars?.[0];
			const v = p?.rapierRigidBody?.linvel?.();
			return {
				phase: s?.match?.phase ?? s?.match?.state,
				y: p?.rapierRigidBody?.translation?.()?.y?.toFixed?.(1),
				speed: v ? Math.hypot(v.x, v.y, v.z).toFixed(1) : null,
				boost: p?.boostFuel,
				auto: window.__igniteMatchDeps?.humanInput?.isAutopilotActive?.(),
			};
		});
		console.log(
			`  +${(t + 5000) / 1000}s frames=${frameIdx} MB=${(bytes / 1e6).toFixed(1)}`,
			info,
		);
	}

	await page.evaluate(() => {
		window.__igniteDynCapture = false;
		window.__igniteMatchDeps?.humanInput?.setAutopilotDrive?.(null);
	});
	try {
		await cdp.send("Page.stopScreencast");
	} catch {
		/* */
	}
	await browser.close();
} finally {
	killElectron();
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
		"/tmp/dyn-mid.gray",
	],
	{ stdio: "inherit" },
);
const g = readFileSync("/tmp/dyn-mid.gray");
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
