#!/usr/bin/env node
/**
 * Promo v8 — boot/loading + spin kart menu + match loading + spektakl
 * (powtórki, Tab, deszcz, pause) + COMING SOON + music fade.
 *
 *   IGNITE_PROMO_SEC=200 node scripts/capture-promo-exile-beat.mjs
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
/** ~85 taktów ≈ 3 min — pełniejsza forma pod Exile */
const SECONDS = Number(process.env.IGNITE_PROMO_SEC || Math.round(BAR * 95));
/** 0 = pełny Exile (~208s); wcześniej 16 ucinało wideo przez -shortest */
const AUDIO_OFFSET = Number(process.env.IGNITE_PROMO_AUDIO_OFFSET || 0);
const BOOT_WAIT = Number(process.env.IGNITE_BOOT_WAIT_MS || 8000);
const PORT = Number(process.env.IGNITE_CDP_PORT || 9236);
const AUDIO = process.env.IGNITE_PROMO_AUDIO || "/tmp/ignite-exile/exile.mp3";
const OUT = join(homedir(), "Wideo");
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const frameDir = join(OUT, `_promo_v8_${stamp}`);
mkdirSync(frameDir, { recursive: true });
const silentMp4 = join(OUT, `ignite-promo-v8-silent-${stamp}.mp4`);
const dest = join(OUT, `ignite-promo-exile-v8-${stamp}.mp4`);
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
	`promo v8 MENU+LOADING+SPINS BPM=${BPM} bar=${BAR.toFixed(3)}s dur=${SECONDS}s audio@${AUDIO_OFFSET}`,
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

	/** ——— BOOT / LOADING (nagrywamy od razu) ——— */
	console.log("SHOT boot/loading");
	await sleep(Math.round(BAR * 5 * 1000)); // ~10s cinematic/loading

	await page.waitForFunction(
		() => !!document.getElementById("main-menu-start"),
		null,
		{ timeout: 180000 },
	);
	console.log("menu ready");
	/** Daj menu dojść (cards intro) */
	await sleep(2500);

	/** ——— MENU: spin kart ——— */
	console.log("SHOT menu card spins");
	const spinNext = async (n, gapMs = 1600) => {
		for (let i = 0; i < n; i++) {
			await page.evaluate(() => {
				document.getElementById("mode-grid-next")?.click();
			});
			console.log(`  spin next ${i + 1}/${n}`);
			await sleep(gapMs);
		}
	};
	const spinPrev = async (n, gapMs = 1500) => {
		for (let i = 0; i < n; i++) {
			await page.evaluate(() => {
				document.getElementById("mode-grid-prev")?.click();
			});
			console.log(`  spin prev ${i + 1}/${n}`);
			await sleep(gapMs);
		}
	};

	await spinNext(5, 1700);
	await sleep(800);

	console.log("SHOT deck swap → experimental");
	await page.evaluate(() => {
		document.getElementById("main-menu-deck-toggle")?.click();
	});
	await sleep(1800);
	await spinNext(3, 1600);

	console.log("SHOT deck swap → core");
	await page.evaluate(() => {
		document.getElementById("main-menu-deck-toggle")?.click();
	});
	await sleep(1800);
	await spinPrev(2, 1500);

	console.log("SHOT select 2v2");
	await page.evaluate(() => {
		const card =
			document.querySelector('[data-mode="2v2"]') ||
			document.querySelector('[data-mode="ignitionRush2v2"]') ||
			document.querySelector('[data-mode="ignition"]');
		card?.click();
	});
	await sleep(2200);

	/** ——— MATCH LOADING ——— */
	console.log("launch 2v2 → match loading");
	await page.evaluate(() => {
		const card =
			document.querySelector('[data-mode="2v2"]') ||
			document.querySelector('[data-mode="ignitionRush2v2"]');
		card?.click();
		document.getElementById("main-menu-start")?.click();
	});

	/** Poczekaj aż loading meczu będzie widoczny, potem auta */
	await page
		.waitForFunction(
			() => {
				const el = document.getElementById("loading");
				if (!el) return false;
				const st = getComputedStyle(el);
				return st.display !== "none" && st.opacity !== "0" && !el.classList.contains("hidden");
			},
			null,
			{ timeout: 15000 },
		)
		.catch(() => console.log("  (match loading overlay not detected — continue)"));
	console.log("SHOT match loading");
	await sleep(Math.round(BAR * 4 * 1000)); // pokaż loading ~8s

	await page.waitForFunction(
		() => (window.__igniteSession?.cars?.length ?? 0) >= 2,
		null,
		{ timeout: 180000 },
	);
	const nCars = await page.evaluate(
		() => window.__igniteSession?.cars?.length ?? 0,
	);
	console.log("cars", nCars);

	/** Logo watermark dopiero w meczu — nie zasłania kart menu */
	await page.evaluate(() => {
		document.getElementById("promo-logo-wm")?.remove();
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
				"#error, .social-fab, #dev-free-cam-badge, #loading, #clip-rec-badge, #boost-panel, #speed-panel, #cam-indicator, #supersonic-banner, #power-shot-banner, #demolish-banner, #epic-save-banner, #post-hit-banner",
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
				console.log("[v8]", name, tSec.toFixed(1));
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
				 * Timeline (bars from MATCH start — menu/loading already filmed):
				 * 0–6 kickoff+boost
				 * 6–12 ground shot
				 * 12–18 pass+boost
				 * 18–26 aerial goal + replay
				 * 26–30 TAB
				 * 30–38 rain boost chase
				 * 38–46 ground goal rain + replay
				 * 46–50 clear
				 * 50–58 aerial + boost flip
				 * 58–66 final aerial goal + replay
				 * 66–70 pause menu
				 * 70+ hold
				 */
				if (bar < 6) {
					if (begin("kickoff", tSec)) {
						rain(false);
						poseBall({ x: 0, y: 1.05, z: 0 });
						poseCar(a, { x: 0, y: 0.9, z: -half + 11 }, 0);
						if (mate) poseCar(mate, { x: -14, y: 0.9, z: -half + 16 }, 0.2);
						if (foe) poseCar(foe, { x: 0, y: 0.9, z: half - 11 }, Math.PI);
						park([a, mate, foe]);
					}
					const L = lt(tSec);
					if (pulse(1.0, 1.12, L)) {
						poseCar(a, { x: 0, y: 0.9, z: -half + 11 }, 0, 0, 0, {
							x: 0,
							y: 0,
							z: 22,
						});
						if (foe)
							poseCar(foe, { x: 1, y: 0.9, z: half - 11 }, Math.PI, 0, 0, {
								x: 0,
								y: 0,
								z: -20,
							});
					}
					if (pulse(2.6, 2.75, L)) {
						poseBall({ x: 0.4, y: 1.3, z: 0 }, { x: 5, y: 4, z: 16 });
					}
					setCam(
						{ x: -10, y: 5 + L * 0.5, z: -half + 2 - L },
						{ x: 0, y: 1.5, z: -half + 18 + L * 5 },
					);
				} else if (bar < 12) {
					if (begin("ground_shot", tSec)) {
						poseCar(a, { x: -4, y: 0.9, z: half - 28 }, 0.15);
						if (mate) poseCar(mate, { x: 16, y: 0.9, z: 0 }, -0.3);
						if (foe) poseCar(foe, { x: 2, y: 0.9, z: half - 8 }, Math.PI);
						park([a, mate, foe]);
						poseBall({ x: -2, y: 1.15, z: half - 22 });
					}
					const L = lt(tSec);
					if (pulse(0.5, 0.65, L)) {
						poseCar(a, { x: -3, y: 0.9, z: half - 26 }, 0.1, 0, 0, {
							x: 2,
							y: 0,
							z: 24,
						});
						poseBall(
							{ x: -1.5, y: 1.2, z: half - 20 },
							{ x: 1, y: 1.5, z: 28 },
						);
					}
					if (pulse(2.0, 2.15, L)) {
						poseBall(
							{ x: 0.3, y: 1.4, z: half - 4 },
							{ x: 0, y: 2, z: 22 },
						);
					}
					setCam(
						{ x: a ? -8 : -8, y: 4.5, z: half - 36 },
						{ x: ballT.x, y: 1.5, z: ballT.z },
					);
				} else if (bar < 18) {
					if (begin("pass_boost", tSec)) {
						poseCar(a, { x: -20, y: 0.9, z: -10 }, 1.0);
						if (mate) poseCar(mate, { x: 16, y: 0.9, z: 8 }, -0.5);
						if (foe) poseCar(foe, { x: 0, y: 0.9, z: 24 }, Math.PI);
						park([a, mate, foe]);
						poseBall({ x: -16, y: 1.15, z: -8 });
					}
					const L = lt(tSec);
					if (pulse(0.55, 0.7, L)) {
						poseCar(a, { x: -18, y: 0.9, z: -8 }, 1.0, 0, 0, {
							x: 14,
							y: 0,
							z: 6,
						});
						poseBall(
							{ x: -14, y: 1.4, z: -5 },
							{ x: 24, y: 5, z: 12 },
						);
					}
					if (pulse(2.6, 2.75, L) && mate) {
						poseCar(mate, { x: 14, y: 0.9, z: 10 }, -0.4, 0, 0, {
							x: -2,
							y: 0,
							z: 12,
						});
						poseBall({ x: 13, y: 1.5, z: 11 }, { x: 2, y: 3, z: 14 });
					}
					setCam(
						{ x: ballT.x - 12, y: 9, z: ballT.z - 12 },
						{ x: ballT.x, y: 2, z: ballT.z },
					);
				} else if (bar < 26) {
					if (begin("aerial_goal", tSec)) {
						poseCar(a, { x: -8, y: 0.95, z: half - 30 }, 0.35);
						if (mate) poseCar(mate, { x: 18, y: 0.9, z: half - 40 }, 0);
						if (foe) poseCar(foe, { x: 4, y: 0.9, z: half - 5 }, Math.PI);
						park([a, mate, foe]);
						poseBall({ x: -4, y: 3, z: half - 24 }, { x: 4, y: 14, z: 10 });
					}
					const L = lt(tSec);
					if (pulse(0.9, 1.05, L)) {
						poseCar(a, { x: -4, y: 1.3, z: half - 22 }, 0.4, -0.4, 0.25, {
							x: 6,
							y: 15,
							z: 12,
						});
						poseBall(
							{ x: -1, y: 9, z: half - 16 },
							{ x: 3, y: 7, z: 10 },
						);
					}
					if (pulse(2.4, 2.55, L)) {
						poseCar(a, { x: 1, y: 11, z: half - 8 }, 0.35, -0.6, 0.5, {
							x: 3,
							y: 1,
							z: 10,
						});
						poseBall(
							{ x: 2, y: 11.5, z: half - 4 },
							{ x: 1, y: 0.5, z: 18 },
						);
					}
					if (pulse(3.5, 3.65, L)) {
						poseBall(
							{ x: 0.3, y: 4, z: half + 1.0 },
							{ x: 0, y: -1, z: 12 },
						);
						setTimeout(() => {
							try {
								window.__igniteSession?.match?.forceEnterGoalReplay?.();
							} catch {
								/* */
							}
						}, 300);
					}
					const spin = tSec * ((bpm / 60) * Math.PI * 0.5);
					setCam(
						{
							x: ballT.x + Math.cos(spin) * 15,
							y: Math.max(9, ballT.y + 3),
							z: ballT.z + Math.sin(spin) * 15,
						},
						{ x: ballT.x, y: ballT.y, z: ballT.z },
					);
				} else if (bar < 30) {
					if (begin("tab", tSec)) {
						window.__igniteCaptureCamLock = false;
						tab(true);
					}
					tab(true);
				} else if (bar < 38) {
					if (begin("rain_boost", tSec)) {
						tab(false);
						rain(true);
						poseCar(a, { x: 0, y: 0.9, z: -20 }, 0);
						if (mate) poseCar(mate, { x: -18, y: 0.9, z: -8 }, 0.3);
						if (foe) poseCar(foe, { x: 8, y: 0.9, z: 18 }, Math.PI);
						park([a, mate, foe]);
						poseBall({ x: 2, y: 1.2, z: -8 });
					}
					const L = lt(tSec);
					if (pulse(0.4, 0.55, L)) {
						poseCar(a, { x: 0, y: 0.9, z: -18 }, 0, 0, 0, {
							x: 1,
							y: 0,
							z: 28,
						});
						poseBall({ x: 1, y: 1.4, z: -4 }, { x: 2, y: 5, z: 18 });
					}
					if (pulse(3.0, 3.15, L)) {
						poseCar(a, { x: 2, y: 0.95, z: 8 }, 0.1, 0, 0, {
							x: 0,
							y: 2,
							z: 24,
						});
					}
					setCam(
						{ x: -12, y: 5, z: ballT.z - 14 },
						{ x: ballT.x, y: 1.8, z: ballT.z + 4 },
					);
				} else if (bar < 46) {
					if (begin("ground_goal_rain", tSec)) {
						rain(true);
						poseCar(a, { x: 0, y: 0.9, z: half - 22 }, 0);
						if (foe) poseCar(foe, { x: -5, y: 0.9, z: half - 6 }, Math.PI);
						park([a, mate, foe]);
						poseBall({ x: 0.4, y: 1.15, z: half - 16 });
					}
					const L = lt(tSec);
					if (pulse(0.5, 0.65, L)) {
						poseCar(a, { x: 0, y: 0.9, z: half - 20 }, 0, 0, 0, {
							x: 0,
							y: 0,
							z: 24,
						});
						poseBall(
							{ x: 0.3, y: 1.25, z: half - 14 },
							{ x: 0, y: 1.5, z: 28 },
						);
					}
					if (pulse(1.8, 1.95, L)) {
						poseBall(
							{ x: 0.2, y: 1.5, z: half + 1.0 },
							{ x: 0, y: 0.3, z: 14 },
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
						{ x: 10, y: 6, z: half - 28 },
						{ x: 0, y: 2, z: half },
					);
				} else if (bar < 50) {
					if (begin("clear", tSec)) {
						rain(false);
						tab(false);
						window.__igniteCaptureCamLock = false;
					}
				} else if (bar < 58) {
					if (begin("air_boost", tSec)) {
						rain(false);
						poseCar(a, { x: -10, y: 0.95, z: -6 }, 0.5);
						if (mate) poseCar(mate, { x: 20, y: 0.9, z: -20 }, 0);
						if (foe) poseCar(foe, { x: 6, y: 0.9, z: 20 }, Math.PI);
						park([a, mate, foe]);
						poseBall({ x: -6, y: 2, z: 0 }, { x: 5, y: 13, z: 8 });
					}
					const L = lt(tSec);
					if (pulse(0.7, 0.85, L)) {
						poseCar(a, { x: -6, y: 1.4, z: -2 }, 0.45, -0.35, 0.4, {
							x: 8,
							y: 16,
							z: 10,
						});
					}
					if (pulse(2.2, 2.35, L)) {
						poseCar(a, { x: 0, y: 12, z: 8 }, 0.3, -0.5, 0.8, {
							x: 4,
							y: 2,
							z: 8,
						});
						poseBall({ x: 2, y: 12.5, z: 10 }, { x: 4, y: 1, z: 12 });
					}
					if (pulse(4.0, 4.15, L)) {
						poseCar(a, { x: 6, y: 8, z: 18 }, 0.2, 0.15, -0.4, {
							x: 2,
							y: -3,
							z: 10,
						});
						poseBall({ x: 8, y: 7, z: 22 }, { x: 3, y: 2, z: 16 });
					}
					const spin = tSec * 0.9;
					setCam(
						{
							x: ballT.x + Math.cos(spin) * 18,
							y: 14,
							z: ballT.z + Math.sin(spin) * 18,
						},
						{ x: ballT.x, y: ballT.y, z: ballT.z },
					);
				} else if (bar < 66) {
					if (begin("final_aerial_goal", tSec)) {
						poseCar(a, { x: -2, y: 1.0, z: half - 26 }, 0.25);
						if (foe) poseCar(foe, { x: 8, y: 0.9, z: half - 4 }, Math.PI);
						park([a, mate, foe]);
						poseBall({ x: 0, y: 4, z: half - 18 }, { x: 1, y: 12, z: 8 });
					}
					const L = lt(tSec);
					if (pulse(0.8, 0.95, L)) {
						poseCar(a, { x: 0, y: 1.5, z: half - 20 }, 0.2, -0.45, 0.3, {
							x: 2,
							y: 14,
							z: 12,
						});
						poseBall(
							{ x: 1, y: 10, z: half - 12 },
							{ x: 1, y: 6, z: 10 },
						);
					}
					if (pulse(2.5, 2.65, L)) {
						poseCar(a, { x: 1, y: 12, z: half - 6 }, 0.15, -0.65, 0.4, {
							x: 1,
							y: 0,
							z: 10,
						});
						poseBall(
							{ x: 1.2, y: 12.2, z: half - 2 },
							{ x: 0, y: 0, z: 16 },
						);
					}
					if (pulse(3.6, 3.75, L)) {
						poseBall(
							{ x: 0.2, y: 5, z: half + 1.1 },
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
						{ x: -14, y: 10, z: half - 20 },
						{ x: ballT.x, y: Math.max(3, ballT.y), z: half },
					);
				} else if (bar < 70) {
					if (begin("pause", tSec)) {
						window.__igniteCaptureCamLock = false;
						pauseMenu(true);
					}
					pauseMenu(true);
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
			console.log("[v8] choreo armed");
		},
		{ barSec: BAR, bpm: BPM, matchOffsetSec },
	);

	/** Match choreo ~70 bars; total wall clock = menu + match */
	const matchDurSec = Math.round(BAR * 72);
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
			width: "min(52vw, 720px)",
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
		"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p,setsar=1",
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"18",
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
		"title=Ignite Promo v8 — menu spins, loading, Coming Soon",
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
