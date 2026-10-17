#!/usr/bin/env node
/**
 * Promo „Ben style” — IPV: dynamiczne menu (Friends/Garage/karty) → 1v1 spektakl.
 * Inna choreografia niż kickoff→pass→aerial→rain→pause (stary beat).
 *
 *   IGNITE_PROMO_SEC=175 node scripts/capture-promo-ben-style.mjs
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

// Line-buffer logs when stdout is redirected.
if (typeof process.stdout?.fd === "number") {
	try {
		process.stdout._handle?.setBlocking?.(true);
	} catch {
		/* */
	}
}

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const BPM = Number(process.env.IGNITE_PROMO_BPM || 113);
const BAR = (60 / BPM) * 4;
/** ~3 min jak Ben Play Video #1 */
const SECONDS = Number(process.env.IGNITE_PROMO_SEC || Math.round(BAR * 82));
/** 0 = pełny Exile (~208s); wcześniej 16 ucinało wideo przez -shortest */
const AUDIO_OFFSET = Number(process.env.IGNITE_PROMO_AUDIO_OFFSET || 0);
const BOOT_WAIT = Number(process.env.IGNITE_BOOT_WAIT_MS || 5000);
const PORT = Number(process.env.IGNITE_CDP_PORT || 9241);
const AUDIO = process.env.IGNITE_PROMO_AUDIO || "/tmp/ignite-exile/exile.mp3";
const OUT = join(homedir(), "Wideo");
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const frameDir = join(OUT, `_promo_ben_${stamp}`);
mkdirSync(frameDir, { recursive: true });
const silentMp4 = join(OUT, `ignite-promo-ben-silent-${stamp}.mp4`);
const dest = join(OUT, `ignite-promo-benstyle-${stamp}.mp4`);
/** COMING SOON (~5s) + logo fade (~6s) */
const END_CARD_SEC = 11;

if (!existsSync(AUDIO)) {
	console.error("Brak audio:", AUDIO);
	process.exit(1);
}
spawnSync("pkill", ["-x", "electron"], { stdio: "ignore" });

const viteOk = await fetch("http://127.0.0.1:5173/")
	.then((r) => r.ok)
	.catch(() => false);
if (!viteOk) {
	console.error("Brak Vite na :5173");
	process.exit(1);
}

console.log(
	`promo BEN-STYLE BPM=${BPM} bar=${BAR.toFixed(3)}s dur=${SECONDS}s audio@${AUDIO_OFFSET}`,
);

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
		"--remote-allow-origins=*",
	],
	{
		cwd: ROOT,
		env: {
			...process.env,
			IGNITE_DEV: "1",
			IGNITE_WINDOWED: "1",
			IGNITE_CAPTURE_LOCK: "1",
			/** Bez skipIntro — widać boot loading / cinematic */
			IGNITE_VITE_URL:
				"http://127.0.0.1:5173/?graphics=high&videoIntro=1",
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
	console.log(`settle ${BOOT_WAIT}ms (screencast starts ASAP — boot loading in shot)`);
	await new Promise((r) => setTimeout(r, BOOT_WAIT));
	if (child.exitCode != null) throw new Error(`electron died ${child.exitCode}`);

	console.log("CDP connect…");
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
	const context = browser.contexts()[0];
	const page =
		context.pages().find((p) => p.url().includes("5173")) ||
		context.pages()[0];
	console.log("page", page?.url?.() ?? "(none)");
	const cdp = await context.newCDPSession(page);

	let frameIdx = 0;
	cdp.on("Page.screencastFrame", async (params) => {
		const i = frameIdx++;
		writeFileSync(
			join(frameDir, `f_${String(i).padStart(6, "0")}.jpg`),
			Buffer.from(params.data, "base64"),
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
		quality: 88,
		maxWidth: 1920,
		maxHeight: 1080,
		everyNthFrame: 1,
	});

	const recStart = Date.now();
	const sleep = (ms) => page.waitForTimeout(ms);

	/** Mute game BGM early (Exile na mux) */
	await page.evaluate(() => {
		const mute = () => {
			const audio = window.__igniteMatchDeps?.audio;
			if (!audio) return false;
			audio.musicMuted = true;
			try {
				audio.matchMusic?.setVolume?.(0);
			} catch {
				/* */
			}
			return true;
		};
		mute();
		const id = setInterval(() => {
			if (mute()) clearInterval(id);
		}, 400);
		setTimeout(() => clearInterval(id), 30000);
	});

	/** ——— BOOT / LOADING (krótko — Ben szybko wchodzi w vibe) ——— */
	console.log("SHOT boot/loading");
	await sleep(Math.round(BAR * 3 * 1000)); // ~6s

	await page.waitForFunction(
		() => !!document.getElementById("main-menu-start"),
		null,
		{ timeout: 180000 },
	);
	console.log("menu ready");
	await sleep(500);

	await page.evaluate(() => {
		window.__igniteCaptureCamLock = false;
		window.__igniteCaptureFreezePhysics = false;
		const live = window.__igniteLiveMenu;
		live?.setPromoOrbitBoost?.(true);
		live?.setPointerNorm?.(0.22, -0.1);
		document.body.classList.remove("showcase-canvas-only");
	});

	/** ——— KARTY OD RAZU: hover spin + highlight (1v1 w centrum uwagi) ——— */
	console.log("SHOT playlist: rapid card spins");
	await page.evaluate(() => {
		const card = document.querySelector('[data-mode="1v1"]');
		card?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
		card?.click();
	});
	await sleep(900);
	for (const mode of ["2v2", "3v3", "4v4", "1v1"]) {
		await page.evaluate((id) => {
			const card =
				document.querySelector(`[data-mode="${id}"]`) ||
				document.querySelector(`#mode-grid .mode-card`);
			if (!card) return;
			card.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
			card.focus({ preventScroll: true });
			card.click();
		}, mode);
		console.log(`  spotlight ${mode}`);
		await sleep(780);
	}

	/** ——— FRIENDS: fab → party tab → close ——— */
	console.log("SHOT friends → party tab");
	await page.evaluate(() => {
		document.getElementById("social-fab")?.click();
	});
	await sleep(900);
	await page.evaluate(() => {
		document
			.querySelector('#social-panel [data-tab="party"]')
			?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	await sleep(1200);
	await page.evaluate(() => {
		if (document.getElementById("social-panel")?.classList.contains("is-open")) {
			document.getElementById("social-fab")?.click();
		}
	});
	await sleep(400);

	/** ——— GARAGE flash ——— */
	console.log("SHOT garage open/close");
	await page.evaluate(() => {
		document.getElementById("main-menu-garage")?.click();
	});
	await sleep(1600);
	await page.evaluate(() => {
		document.querySelector("[data-garage-close]")?.dispatchEvent(
			new MouseEvent("click", { bubbles: true }),
		);
	});
	await sleep(500);

	/** ——— LAB deck peek + PLAY CTA ——— */
	console.log("SHOT deck LAB peek + PLAY");
	await page.evaluate(() => {
		document.getElementById("main-menu-deck-toggle")?.click();
	});
	await sleep(900);
	await page.keyboard.press("ArrowRight");
	await sleep(700);
	await page.keyboard.press("ArrowRight");
	await sleep(700);
	await page.evaluate(() => {
		document.getElementById("main-menu-deck-toggle")?.click();
	});
	await sleep(700);
	await page.evaluate(() => {
		const card = document.querySelector('[data-mode="1v1"]');
		card?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
		card?.click();
		document
			.getElementById("main-menu-start")
			?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
	});
	await sleep(900);

	/** ——— LAUNCH 1v1 ——— */
	console.log("launch 1v1 → match loading");
	await page.evaluate(() => {
		document.querySelector('[data-mode="1v1"]')?.click();
		document.getElementById("main-menu-start")?.click();
	});

	await page
		.waitForFunction(
			() => {
				const el = document.getElementById("loading");
				if (!el) return false;
				const st = getComputedStyle(el);
				return (
					st.display !== "none" &&
					st.opacity !== "0" &&
					!el.classList.contains("hidden")
				);
			},
			null,
			{ timeout: 15000 },
		)
		.catch(() => console.log("  (match loading overlay not detected — continue)"));
	console.log("SHOT match loading");
	await sleep(Math.round(BAR * 1.8 * 1000));

	await page.waitForFunction(
		() => (window.__igniteSession?.cars?.length ?? 0) >= 2,
		null,
		{ timeout: 180000 },
	);
	const nCars = await page.evaluate(
		() => window.__igniteSession?.cars?.length ?? 0,
	);
	console.log("cars", nCars);

	/** Logo + letterbox jak Ben Play Video #1 */
	await page.evaluate(() => {
		document.getElementById("promo-logo-wm")?.remove();
		document.getElementById("promo-letterbox")?.remove();

		const lb = document.createElement("div");
		lb.id = "promo-letterbox";
		Object.assign(lb.style, {
			position: "fixed",
			inset: "0",
			zIndex: "99990",
			pointerEvents: "none",
			boxShadow: "inset 0 54px 0 #000, inset 0 -54px 0 #000",
		});
		document.body.appendChild(lb);

		const wrap = document.createElement("div");
		wrap.id = "promo-logo-wm";
		Object.assign(wrap.style, {
			position: "fixed",
			left: "28px",
			top: "70px",
			right: "auto",
			bottom: "auto",
			transform: "none",
			zIndex: "99999",
			pointerEvents: "none",
		});
		const img = document.createElement("img");
		img.src = `/assets/ui/menu/ignite_modern_logo.png?v=${Date.now()}`;
		img.alt = "Ign!te";
		Object.assign(img.style, {
			width: "min(42vw, 560px)",
			filter: "drop-shadow(0 8px 28px rgba(0,0,0,0.95))",
			opacity: "0.96",
		});
		wrap.appendChild(img);
		document.body.appendChild(wrap);

		document
			.querySelectorAll(
				"#error, .social-fab, #social-panel, #dev-free-cam-badge, #loading, #clip-rec-badge, #boost-panel, #speed-panel, #cam-indicator, #supersonic-banner, #power-shot-banner, #demolish-banner, #epic-save-banner, #post-hit-banner, #kickoff-banner",
			)
			.forEach((el) => {
				el.style.display = "none";
			});
		const s = window.__igniteSession;
		s?.match?.setCountdownHold?.(false);
		s?.match?.forceStartPlaying?.();
		window.__igniteCaptureFreezePhysics = false;
		window.__igniteCaptureCamLock = false;
		window.__igniteMatchDeps?.humanInput?.setAutopilotDrive?.(null);

		const audio = window.__igniteMatchDeps?.audio;
		if (audio) {
			audio.musicMuted = true;
			try {
				audio.matchMusic?.setVolume?.(0);
			} catch {
				/* */
			}
		}
	});

	/** Takty choreografii liczone OD startu meczu (nie od bootu) */
	const matchOffsetSec = (Date.now() - recStart) / 1000;
	console.log("matchOffset", matchOffsetSec.toFixed(1));

	await page.evaluate(
		({ barSec, bpm, matchOffsetSec }) => {
			const THREE = window.__THREE;
			const matchT0 = performance.now();
			let lastShot = "";
			let shotT0 = 0;

			const half =
				window.__igniteArenaHalfLength ??
				window.__igniteMatchDeps?.arena?.HALF_LENGTH ??
				51.2;
			const halfW =
				window.__igniteArenaHalfWidth ??
				window.__igniteMatchDeps?.arena?.HALF_WIDTH ??
				40.96;

			const teamOf = (c) =>
				c?.team ?? c?.visualTeam ?? c?.player?.team ?? null;
			const bodyOf = (c) => {
				const p = c?.player ?? c;
				return { player: p, body: p?.rapierRigidBody };
			};

			const poseCar = (c, pos, yaw, pitch = 0, roll = 0, vel = null) => {
				const { player, body } = bodyOf(c);
				if (!body) return;
				body.setTranslation(pos, true);
				body.setLinvel(vel ?? { x: 0, y: 0, z: 0 }, true);
				body.setAngvel({ x: 0, y: 0, z: 0 }, true);
				if (THREE) {
					const q = new THREE.Quaternion().setFromEuler(
						new THREE.Euler(pitch, yaw, roll, "YXZ"),
					);
					body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
					player.syncWithRigidBody?.();
					if (player.threeJSGroup) {
						player.threeJSGroup.position.set(pos.x, pos.y, pos.z);
						player.threeJSGroup.quaternion.copy(q);
						player.threeJSGroup.updateMatrixWorld(true);
					}
				} else {
					const hy = yaw * 0.5;
					body.setRotation(
						{ x: 0, y: Math.sin(hy), z: 0, w: Math.cos(hy) },
						true,
					);
				}
				if (typeof player.boostFuel === "number") player.boostFuel = 1;
			};

			const poseBall = (pos, vel = null) => {
				const ball = window.__igniteBall;
				if (!ball?.rapierRigidBody) return;
				ball.rapierRigidBody.setTranslation(pos, true);
				ball.rapierRigidBody.setLinvel(vel ?? { x: 0, y: 0, z: 0 }, true);
				ball.rapierRigidBody.setAngvel({ x: 2, y: 0, z: 1 }, true);
				ball.syncWithRigidBody?.();
			};

			const blues = () =>
				(window.__igniteSession?.cars ?? []).filter(
					(c) => teamOf(c) === "blue",
				);
			const oranges = () =>
				(window.__igniteSession?.cars ?? []).filter(
					(c) => teamOf(c) === "orange",
				);

			const park = (keep) => {
				const set = new Set(keep.filter(Boolean));
				for (const c of window.__igniteSession?.cars ?? []) {
					if (set.has(c)) continue;
					const side = teamOf(c) === "orange" ? 1 : -1;
					poseCar(
						c,
						{ x: side * 30, y: 0.9, z: side * (half - 6) },
						side > 0 ? Math.PI : 0,
					);
				}
			};

			const setCam = (pos, look, lock = true) => {
				const r =
					window.__igniteMatchDeps?.renderer ??
					window.__igniteRenderer;
				const cam = r?.threeJSCamera;
				if (!cam) return;
				window.__igniteCaptureCamLock = lock;
				if (!lock) return;
				cam.position.set(pos.x, pos.y, pos.z);
				cam.up.set(0, 1, 0);
				cam.lookAt(look.x, look.y, look.z);
				cam.updateMatrixWorld?.(true);
			};

			const rain = (on) => {
				try {
					window.__igniteScene?.weather?.setRaining?.(on);
				} catch {
					/* */
				}
			};

			const tab = (on) => {
				const el = document.getElementById("match-scoreboard");
				if (on) {
					document.dispatchEvent(
						new KeyboardEvent("keydown", {
							code: "Tab",
							key: "Tab",
							bubbles: true,
						}),
					);
					el?.classList.add("show");
					el?.setAttribute("aria-hidden", "false");
				} else {
					document.dispatchEvent(
						new KeyboardEvent("keyup", {
							code: "Tab",
							key: "Tab",
							bubbles: true,
						}),
					);
					el?.classList.remove("show");
					el?.setAttribute("aria-hidden", "true");
				}
			};

			const pauseMenu = (on) => {
				const el = document.getElementById("match-pause");
				if (!el) return;
				if (on) {
					el.classList.remove("hidden", "pause-closing");
					el.classList.add("pause-open");
					document.body.classList.add("game-paused");
				} else {
					el.classList.add("hidden");
					el.classList.remove("pause-open", "pause-closing");
					document.body.classList.remove("game-paused");
				}
			};

			const begin = (name, tSec) => {
				if (lastShot === name) return false;
				lastShot = name;
				shotT0 = tSec;
				tab(false);
				pauseMenu(false);
				window.__igniteMatchDeps?.humanInput?.setAutopilotDrive?.(null);
				// Nie przerywaj replayu przy Tab/pause — pokaż UI nad powtórką.
				if (name !== "tab" && name !== "pause" && name !== "hold") {
					try {
						window.__igniteSession?.match?.forceStartPlaying?.();
					} catch {
						/* */
					}
				}
				console.log("[ben]", name, tSec.toFixed(1));
				return true;
			};
			const lt = (t) => t - shotT0;
			const pulse = (t0, t1, t) => t >= t0 && t < t1;

			const tick = () => {
				if (!window.__ignitePromoBeat) return;
				const tSec = (performance.now() - matchT0) / 1000;
				const bar = Math.floor(tSec / barSec);
				const b = blues();
				const o = oranges();
				const a = b[0] ?? window.__igniteSession?.cars?.[0];
				const mate = b[1] ?? null;
				const foe = o[0] ?? window.__igniteSession?.cars?.[1];
				const ballT =
					window.__igniteBall?.rapierRigidBody?.translation?.() ?? {
						x: 0,
						y: 2,
						z: 0,
					};

				/**
				 * NOWA choreografia 1v1 (nie kickoff→pass→aerial→rain→pause):
				 * 0–5   cold open mid-aerial
				 * 5–12  wall ride
				 * 12–18 bump / demo pressure
				 * 18–24 freestyle flip train
				 * 24–28 scoreboard early
				 * 28–36 rain bumper chase
				 * 36–44 ceiling pinch goal + replay
				 * 44–50 midfield hero orbit
				 * 50–58 goal-line clear
				 * 58–64 ground slap goal + replay
				 * 64–68 kickoff freeze lineup
				 * 68+   hold chase
				 */
				if (bar < 5) {
					if (begin("cold_aerial", tSec)) {
						rain(false);
						poseCar(a, { x: -6, y: 8, z: -4 }, 0.4, -0.55, 0.35, {
							x: 4,
							y: 2,
							z: 8,
						});
						if (foe)
							poseCar(foe, { x: 10, y: 0.9, z: 18 }, Math.PI, 0, 0, {
								x: -2,
								y: 0,
								z: -10,
							});
						park([a, foe]);
						poseBall({ x: -2, y: 10, z: 2 }, { x: 3, y: 1, z: 6 });
					}
					const L = lt(tSec);
					if (pulse(1.2, 1.35, L)) {
						poseCar(a, { x: -2, y: 11, z: 4 }, 0.3, -0.4, 0.6, {
							x: 5,
							y: 1,
							z: 10,
						});
						poseBall({ x: 1, y: 11.5, z: 8 }, { x: 4, y: 0, z: 10 });
					}
					const spin = tSec * 1.15;
					setCam(
						{
							x: ballT.x + Math.cos(spin) * 16,
							y: Math.max(10, ballT.y + 2),
							z: ballT.z + Math.sin(spin) * 16,
						},
						{ x: ballT.x, y: ballT.y, z: ballT.z },
					);
				} else if (bar < 12) {
					if (begin("wall_ride", tSec)) {
						poseCar(a, { x: halfW * 0.92, y: 6, z: -8 }, -1.2, 0.15, 1.45, {
							x: 0,
							y: 4,
							z: 14,
						});
						if (foe) poseCar(foe, { x: 0, y: 0.9, z: 10 }, Math.PI);
						park([a, foe]);
						poseBall({ x: halfW * 0.7, y: 5, z: -2 }, { x: -2, y: 3, z: 8 });
					}
					const L = lt(tSec);
					if (pulse(1.0, 1.15, L)) {
						poseCar(a, { x: halfW * 0.9, y: 9, z: 4 }, -1.1, 0.1, 1.5, {
							x: -1,
							y: 6,
							z: 12,
						});
					}
					if (pulse(3.0, 3.15, L)) {
						poseCar(a, { x: halfW * 0.55, y: 12, z: 16 }, -0.6, -0.2, 0.8, {
							x: -8,
							y: 2,
							z: 10,
						});
						poseBall({ x: halfW * 0.35, y: 11, z: 18 }, { x: -6, y: 1, z: 8 });
					}
					setCam(
						{ x: halfW * 0.4, y: 8 + L * 0.4, z: ballT.z - 14 },
						{ x: ballT.x, y: Math.max(3, ballT.y), z: ballT.z },
					);
				} else if (bar < 18) {
					if (begin("bump_demo", tSec)) {
						poseCar(a, { x: -4, y: 0.9, z: -6 }, 0.2);
						if (foe) poseCar(foe, { x: 0, y: 0.9, z: 4 }, Math.PI);
						park([a, foe]);
						poseBall({ x: 2, y: 1.2, z: 8 });
					}
					const L = lt(tSec);
					if (pulse(0.6, 0.75, L)) {
						poseCar(a, { x: -2, y: 0.9, z: -2 }, 0.15, 0, 0, {
							x: 6,
							y: 0,
							z: 22,
						});
					}
					if (pulse(1.8, 1.95, L) && foe) {
						poseCar(foe, { x: 1, y: 1.4, z: 6 }, Math.PI, 0.3, 0.4, {
							x: 8,
							y: 8,
							z: 4,
						});
						poseCar(a, { x: 0, y: 0.95, z: 5 }, 0.1, 0, 0, {
							x: 4,
							y: 1,
							z: 18,
						});
					}
					setCam(
						{ x: -14, y: 3.2, z: ballT.z - 6 },
						{ x: 0, y: 1.2, z: ballT.z + 4 },
					);
				} else if (bar < 24) {
					if (begin("flip_train", tSec)) {
						poseCar(a, { x: 0, y: 1.1, z: -12 }, 0);
						if (foe) poseCar(foe, { x: 16, y: 0.9, z: 20 }, Math.PI);
						park([a, foe]);
						poseBall({ x: 0, y: 3, z: -4 }, { x: 0, y: 10, z: 6 });
					}
					const L = lt(tSec);
					if (pulse(0.5, 0.65, L)) {
						poseCar(a, { x: 0, y: 2.5, z: -8 }, 0, -0.5, 0, {
							x: 0,
							y: 14,
							z: 10,
						});
					}
					if (pulse(1.8, 1.95, L)) {
						poseCar(a, { x: 2, y: 10, z: 0 }, 0.2, 0.2, 3.0, {
							x: 2,
							y: 2,
							z: 8,
						});
					}
					if (pulse(3.4, 3.55, L)) {
						poseCar(a, { x: 4, y: 7, z: 10 }, 0.3, -0.3, -1.2, {
							x: 3,
							y: -2,
							z: 10,
						});
						poseBall({ x: 6, y: 6, z: 14 }, { x: 4, y: 2, z: 12 });
					}
					setCam(
						{ x: -10, y: 6, z: -18 + L * 2 },
						{ x: a ? 2 : 0, y: 6, z: L * 3 },
					);
				} else if (bar < 28) {
					if (begin("tab_early", tSec)) {
						window.__igniteCaptureCamLock = false;
						tab(true);
					}
					tab(true);
				} else if (bar < 36) {
					if (begin("rain_bumper", tSec)) {
						tab(false);
						rain(true);
						poseCar(a, { x: -8, y: 0.9, z: -16 }, 0.35);
						if (foe) poseCar(foe, { x: 6, y: 0.9, z: 12 }, Math.PI);
						park([a, foe]);
						poseBall({ x: -4, y: 1.15, z: -8 });
					}
					const L = lt(tSec);
					if (pulse(0.4, 0.55, L)) {
						poseCar(a, { x: -6, y: 0.9, z: -12 }, 0.3, 0, 0, {
							x: 8,
							y: 0,
							z: 26,
						});
						poseBall({ x: -2, y: 1.3, z: -4 }, { x: 6, y: 4, z: 16 });
					}
					if (pulse(2.8, 2.95, L)) {
						poseCar(a, { x: 4, y: 0.95, z: 10 }, 0.1, 0, 0, {
							x: 2,
							y: 1,
							z: 22,
						});
					}
					setCam(
						{ x: ballT.x - 3, y: 1.6, z: ballT.z - 9 },
						{ x: ballT.x + 2, y: 1.2, z: ballT.z + 8 },
					);
				} else if (bar < 44) {
					if (begin("ceiling_pinch", tSec)) {
						rain(true);
						poseCar(a, { x: 2, y: 14, z: half - 22 }, 0.15, 0.85, 0);
						if (foe) poseCar(foe, { x: -6, y: 0.9, z: half - 6 }, Math.PI);
						park([a, foe]);
						poseBall({ x: 1, y: 13, z: half - 16 }, { x: 0, y: -2, z: 8 });
					}
					const L = lt(tSec);
					if (pulse(1.0, 1.15, L)) {
						poseCar(a, { x: 1, y: 12, z: half - 12 }, 0.1, 0.5, 0.2, {
							x: 0,
							y: -4,
							z: 12,
						});
						poseBall({ x: 0.5, y: 10, z: half - 8 }, { x: 0, y: -3, z: 14 });
					}
					if (pulse(2.8, 2.95, L)) {
						poseBall(
							{ x: 0.2, y: 3.5, z: half + 0.9 },
							{ x: 0, y: -2, z: 10 },
						);
						setTimeout(() => {
							try {
								window.__igniteSession?.match?.forceEnterGoalReplay?.();
							} catch {
								/* */
							}
						}, 280);
					}
					setCam(
						{ x: -12, y: 16, z: half - 24 },
						{ x: ballT.x, y: Math.max(4, ballT.y), z: half - 4 },
					);
				} else if (bar < 50) {
					if (begin("hero_orbit", tSec)) {
						rain(false);
						poseCar(a, { x: -8, y: 0.9, z: 0 }, 0.6);
						if (foe) poseCar(foe, { x: 8, y: 0.9, z: 0 }, -0.6 + Math.PI);
						park([a, foe]);
						poseBall({ x: 0, y: 1.2, z: 0 });
					}
					const spin = tSec * 0.85;
					setCam(
						{
							x: Math.cos(spin) * 22,
							y: 7,
							z: Math.sin(spin) * 22,
						},
						{ x: 0, y: 1.2, z: 0 },
					);
				} else if (bar < 58) {
					if (begin("goal_line_clear", tSec)) {
						poseCar(a, { x: -3, y: 0.9, z: -half + 6 }, 0);
						if (foe) poseCar(foe, { x: 2, y: 0.9, z: -half + 18 }, Math.PI);
						park([a, foe]);
						poseBall({ x: 0, y: 1.15, z: -half + 10 }, { x: 0, y: 2, z: -8 });
					}
					const L = lt(tSec);
					if (pulse(0.7, 0.85, L)) {
						poseCar(a, { x: -1, y: 0.9, z: -half + 8 }, 0, 0, 0, {
							x: 1,
							y: 0,
							z: -18,
						});
						poseBall(
							{ x: 0.2, y: 1.4, z: -half + 4 },
							{ x: 0, y: 3, z: -16 },
						);
					}
					if (pulse(2.2, 2.35, L)) {
						poseBall({ x: 4, y: 2, z: -half + 20 }, { x: 10, y: 5, z: 18 });
						poseCar(a, { x: 2, y: 0.95, z: -half + 14 }, 0.4, 0, 0, {
							x: 8,
							y: 1,
							z: 16,
						});
					}
					setCam(
						{ x: 0, y: 4, z: -half - 6 },
						{ x: ballT.x, y: 1.5, z: ballT.z },
					);
				} else if (bar < 64) {
					if (begin("slap_goal", tSec)) {
						poseCar(a, { x: 0, y: 0.9, z: half - 24 }, 0);
						if (foe) poseCar(foe, { x: 5, y: 0.9, z: half - 8 }, Math.PI);
						park([a, foe]);
						poseBall({ x: 0.3, y: 1.15, z: half - 18 });
					}
					const L = lt(tSec);
					if (pulse(0.45, 0.6, L)) {
						poseCar(a, { x: 0, y: 0.9, z: half - 20 }, 0, 0, 0, {
							x: 0,
							y: 0,
							z: 28,
						});
						poseBall(
							{ x: 0.2, y: 1.3, z: half - 14 },
							{ x: 0, y: 1.2, z: 30 },
						);
					}
					if (pulse(1.7, 1.85, L)) {
						poseBall(
							{ x: 0.15, y: 1.6, z: half + 1.05 },
							{ x: 0, y: 0.4, z: 12 },
						);
						setTimeout(() => {
							try {
								window.__igniteSession?.match?.forceEnterGoalReplay?.();
							} catch {
								/* */
							}
						}, 250);
					}
					setCam(
						{ x: 14, y: 5, z: half - 30 },
						{ x: 0, y: 1.8, z: half },
					);
				} else if (bar < 68) {
					if (begin("kickoff_freeze", tSec)) {
						rain(false);
						tab(false);
						pauseMenu(false);
						poseCar(a, { x: 0, y: 0.9, z: -half + 12 }, 0);
						if (foe) poseCar(foe, { x: 0, y: 0.9, z: half - 12 }, Math.PI);
						park([a, foe]);
						poseBall({ x: 0, y: 1.05, z: 0 });
					}
					setCam(
						{ x: -18, y: 9, z: 0 },
						{ x: 0, y: 1.2, z: 0 },
					);
				} else {
					if (begin("hold", tSec)) {
						pauseMenu(false);
						tab(false);
						window.__igniteCaptureCamLock = false;
					}
				}

				requestAnimationFrame(tick);
			};

			window.__ignitePromoBeat = true;
			requestAnimationFrame(tick);
			console.log("[ben] choreo v2 armed (1v1 cold-open)");
		},
		{ barSec: BAR, bpm: BPM, matchOffsetSec },
	);

	/** Match choreo ~70 bars; Ben ≈ 3 min wall clock */
	const matchDurSec = Math.round(BAR * 70);
	const recordUntilSec = matchOffsetSec + matchDurSec;
	console.log(
		`recording until ${recordUntilSec.toFixed(0)}s (menu ${matchOffsetSec.toFixed(0)}s + match ${matchDurSec}s)`,
	);
	while ((Date.now() - recStart) / 1000 < recordUntilSec) {
		await page.waitForTimeout(5000);
		const info = await page.evaluate(() => ({
			phase: window.__igniteSession?.match?.getPhase?.(),
			ballZ: window.__igniteBall?.rapierRigidBody
				?.translation?.()
				?.z?.toFixed?.(1),
			rain: !!window.__igniteScene?.weather?.isRaining,
			tab: document
				.getElementById("match-scoreboard")
				?.classList.contains("show"),
		}));
		console.log(
			`  +${((Date.now() - recStart) / 1000).toFixed(0)}s frames=${frameIdx}`,
			info,
		);
	}

	/** End card: black → COMING SOON in/out → logo in/out */
	await page.evaluate(() => {
		window.__ignitePromoBeat = false;
		window.__igniteCaptureCamLock = true;
		document.getElementById("match-pause")?.classList.add("hidden");
		document.getElementById("match-scoreboard")?.classList.remove("show");
		document.body.classList.remove("game-paused");
		document.getElementById("promo-logo-wm")?.remove();

		const root = document.createElement("div");
		root.id = "promo-coming-soon";
		Object.assign(root.style, {
			position: "fixed",
			inset: "0",
			zIndex: "100000",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			background: "rgba(0,0,0,0)",
			pointerEvents: "none",
			transition: "background 1.4s ease",
		});
		const text = document.createElement("div");
		text.textContent = "COMING SOON";
		Object.assign(text.style, {
			fontFamily: '"Orbitron", var(--font-display), sans-serif',
			fontWeight: "900",
			fontSize: "clamp(2.8rem, 8vw, 6.5rem)",
			letterSpacing: "0.22em",
			color: "#fff",
			opacity: "0",
			transform: "translateY(12px)",
			textShadow: "0 0 40px rgba(45,143,255,0.45), 0 4px 24px rgba(0,0,0,0.8)",
			transition: "opacity 1.1s ease, transform 1.1s ease",
			position: "absolute",
		});
		const logo = document.createElement("img");
		logo.src = `/assets/ui/menu/ignite_modern_logo.png?v=${Date.now()}`;
		logo.alt = "Ign!te";
		Object.assign(logo.style, {
			width: "min(58vw, 820px)",
			opacity: "0",
			transform: "translateY(12px)",
			filter: "drop-shadow(0 8px 28px rgba(0,0,0,0.85))",
			transition: "opacity 1.1s ease, transform 1.1s ease",
			position: "absolute",
		});
		root.appendChild(text);
		root.appendChild(logo);
		document.body.appendChild(root);

		requestAnimationFrame(() => {
			root.style.background = "#000";
			setTimeout(() => {
				text.style.opacity = "1";
				text.style.transform = "translateY(0)";
			}, 900);
			setTimeout(() => {
				text.style.opacity = "0";
				text.style.transform = "translateY(-8px)";
			}, 4200);
			setTimeout(() => {
				logo.style.opacity = "1";
				logo.style.transform = "translateY(0)";
			}, 5400);
			setTimeout(() => {
				logo.style.opacity = "0";
				logo.style.transform = "translateY(-8px)";
			}, 9000);
		});
	});
	await page.waitForTimeout(END_CARD_SEC * 1000);

	try {
		await cdp.send("Page.stopScreencast");
	} catch {
		/* */
	}
	await browser.close();
	globalThis.__promoRecSec = (Date.now() - recStart) / 1000;
} finally {
	killElectron();
}

const n = readdirSync(frameDir).filter((f) => f.endsWith(".jpg")).length;
const encDur = Math.max(
	30,
	Number(process.env.IGNITE_PROMO_ENC_DUR) ||
		globalThis.__promoRecSec ||
		SECONDS + END_CARD_SEC,
);
const fps = Math.max(1, Math.round(n / encDur));
console.log(`frames=${n} fps=${fps} encDur=${encDur.toFixed(1)}s`);
if (n < 120) {
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
		"/tmp/promo-v8-mid.gray",
	],
	{ stdio: "inherit" },
);
const mean =
	[...readFileSync("/tmp/promo-v8-mid.gray")].reduce((a, b) => a + b, 0) /
	(64 * 36);
console.log("mid lum", mean.toFixed(1));
if (mean < 10) {
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
		"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,eq=saturation=1.18:contrast=1.08:brightness=0.02,format=yuv420p,setsar=1",
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"17",
		"-movflags",
		"+faststart",
		"-an",
		"-t",
		String(encDur),
		silentMp4,
	],
	{ stdio: "inherit" },
);
if (enc.status !== 0 || !existsSync(silentMp4)) {
	console.error("ffmpeg video fail");
	process.exit(1);
}

/** Music fade-out + apad — bez -shortest (Exile po offsetcie bywa krótszy niż wideo). */
const fadeStart = Math.max(0, encDur - 5);
const mux = spawnSync(
	"ffmpeg",
	[
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		silentMp4,
		"-ss",
		String(AUDIO_OFFSET),
		"-i",
		AUDIO,
		"-filter_complex",
		`[1:a]afade=t=out:st=${fadeStart}:d=5,apad=whole_dur=${encDur},atrim=0:${encDur}[a]`,
		"-map",
		"0:v",
		"-map",
		"[a]",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-t",
		String(encDur),
		"-movflags",
		"+faststart",
		"-metadata",
		"title=Ignite Play Video — Ben-style choreo v2 (1v1)",
		dest,
	],
	{ stdio: "inherit" },
);
if (mux.status !== 0 || !existsSync(dest)) {
	console.error("ffmpeg mux fail");
	process.exit(1);
}

console.log("SAVED", dest);
rmSync(frameDir, { recursive: true, force: true });
try {
	rmSync(silentMp4, { force: true });
} catch {
	/* */
}
spawnSync("ln", ["-sfn", dest, join(OUT, "ignite-promo-LATEST.mp4")], {
	stdio: "ignore",
});
spawnSync("ln", ["-sfn", dest, join(OUT, "IPV.mp4")], { stdio: "ignore" });
spawnSync(
	"ln",
	["-sfn", dest, join(homedir(), ".local/share/ben-vpn-share/IPV.mp4")],
	{ stdio: "ignore" },
);
console.log("LATEST →", join(OUT, "ignite-promo-LATEST.mp4"));
