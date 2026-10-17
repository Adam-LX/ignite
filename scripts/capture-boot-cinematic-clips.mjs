#!/usr/bin/env node
/**
 * Boot cinematic: aerial / boost / flip / goal — animacja klatka po klatce
 * (fizyka OFF — SwiftShader screenshot jest wolny, inaczej auta spadają).
 *
 *   node scripts/capture-boot-cinematic-clips.mjs
 */
import {
	mkdirSync,
	existsSync,
	writeFileSync,
	copyFileSync,
	rmSync,
	readdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const WORK = join(homedir(), "StabilityMatrix", "Images", "IgniteBoot");
const FRAMES = join(WORK, "clip_frames");
mkdirSync(WORK, { recursive: true });
const GAME = join(
	fileURLToPath(new URL("..", import.meta.url)),
	"public/assets/video/ignite_boot_cinematic.mp4",
);
const BASE = (process.env.IGNITE_VITE_URL || "http://127.0.0.1:5173").replace(
	/\?.*$/,
	"",
);
const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.CHROME_PATH ??
	"/run/current-system/sw/bin/chromium";
/** Mało klatek — screenshot SwiftShader ~kilka s/klatkę. */
const FRAMES_PER_SHOT = 14;

const health = await fetch(BASE)
	.then((r) => r.ok)
	.catch(() => false);
if (!health) {
	console.error(`Brak Vite na ${BASE}`);
	process.exit(1);
}

const run = (args) => {
	const r = spawnSync(
		"ffmpeg",
		["-y", "-hide_banner", "-loglevel", "error", ...args],
		{ stdio: "inherit" },
	);
	if (r.status !== 0) {
		console.error("ffmpeg fail");
		process.exit(1);
	}
};

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
	],
});
const page = await browser.newPage({
	viewport: { width: 1280, height: 720 },
	deviceScaleFactor: 1,
});
await page.addInitScript(() => {
	try {
		localStorage.setItem("ignite.seenBootCinematic.v1", "1");
	} catch {
		/* */
	}
});

const url = `${BASE}/?autostart=1v1&skipIntro=1&graphics=high&t=${Date.now()}`;
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
		"#hud, #boost-panel, #speed-panel, #cam-indicator, #supersonic-banner, #power-shot-banner, #demolish-banner, #epic-save-banner, #post-hit-banner, #error, .social-fab, #menu, #dev-free-cam-badge, #scoreboard, #match-clock",
	);
	const s = window.__igniteSession;
	s?.match?.setCountdownHold?.(false);
	s?.match?.forceStartPlaying?.();
	window.__igniteFreeCam?.setActive?.(false);
	window.__igniteCaptureFreezePhysics = true;
	window.__igniteCaptureCamLock = true;
	const scene = window.__igniteScene?.threeJSScene ?? window.__igniteScene;
	scene?.traverse?.((o) => {
		if (
			/tag|name|label|billboard/i.test(o.name || "") ||
			o.userData?.isNameplate
		) {
			o.visible = false;
		}
	});
});
await page.waitForTimeout(1500);

const half = await page.evaluate(
	() =>
		window.__igniteArenaHalfLength ??
		window.__igniteMatchDeps?.arena?.HALF_LENGTH ??
		51.2,
);

function lerp(a, b, t) {
	return a + (b - a) * t;
}
function lerp3(a, b, t) {
	return {
		x: lerp(a.x, b.x, t),
		y: lerp(a.y, b.y, t),
		z: lerp(a.z, b.z, t),
	};
}
function easeInOut(t) {
	return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * @param {string} name
 * @param {(t:number) => object} sample — t in [0,1] → pose+cam
 */
async function captureShot(name, sample) {
	const dir = join(FRAMES, name);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	console.log("SHOT", name, FRAMES_PER_SHOT, "frames");

	for (let i = 0; i < FRAMES_PER_SHOT; i++) {
		const t = easeInOut(i / (FRAMES_PER_SHOT - 1));
		const cfg = sample(t);
		await page.evaluate((cfg) => {
			const THREE = window.__THREE;
			const s = window.__igniteSession;
			const ball = window.__igniteBall;
			const r =
				window.__igniteMatchDeps?.renderer ?? window.__igniteRenderer;
			const cam = r?.threeJSCamera;
			if (!THREE || !s || !cam) return;

			window.__igniteCaptureFreezePhysics = true;
			window.__igniteCaptureCamLock = true;
			window.__igniteBootClip = null;
			window.__igniteFreeCam?.setActive?.(false);

			const poseCar = (carLike, pos, eul) => {
				const player = carLike?.player ?? carLike;
				const body = player?.rapierRigidBody;
				if (!body) return;
				body.setTranslation(pos, true);
				body.setLinvel({ x: 0, y: 0, z: 0 }, true);
				body.setAngvel({ x: 0, y: 0, z: 0 }, true);
				const q = new THREE.Quaternion().setFromEuler(
					new THREE.Euler(
						eul?.pitch ?? 0,
						eul?.yaw ?? 0,
						eul?.roll ?? 0,
						"YXZ",
					),
				);
				body.setRotation(
					{ x: q.x, y: q.y, z: q.z, w: q.w },
					true,
				);
				player.syncWithRigidBody?.();
				if (player.threeJSGroup) {
					player.threeJSGroup.position.set(pos.x, pos.y, pos.z);
					player.threeJSGroup.quaternion.copy(q);
					player.threeJSGroup.updateMatrixWorld(true);
				}
			};

			for (const c of cfg.cars) {
				poseCar(s.cars[c.i], c.pos, c.eul);
			}
			if (cfg.ball && ball?.rapierRigidBody) {
				ball.rapierRigidBody.setTranslation(cfg.ball.pos, true);
				ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
				ball.syncWithRigidBody?.();
			}

			cam.position.set(cfg.cam[0], cfg.cam[1], cfg.cam[2]);
			cam.up.set(0, 1, 0);
			cam.lookAt(cfg.look[0], cfg.look[1], cfg.look[2]);
			cam.updateMatrixWorld(true);
			cam.updateProjectionMatrix();

			/** Wymuś 1 render z tą kamerą. */
			r?.render?.(window.__igniteScene ?? r.scene, 0.016);
		}, cfg);

		await page.waitForTimeout(80);
		await page.screenshot({
			path: join(dir, `f_${String(i).padStart(4, "0")}.jpg`),
			type: "jpeg",
			quality: 82,
		});
		if (i % 4 === 0) console.log(" ", name, i + 1, "/", FRAMES_PER_SHOT);
	}

	const out = join(WORK, `clip_${name}.mp4`);
	run([
		"-framerate",
		"12",
		"-i",
		join(dir, "f_%04d.jpg"),
		"-vf",
		"scale=1920:1080:flags=lanczos,format=yuv420p",
		"-c:v",
		"libx264",
		"-preset",
		"fast",
		"-crf",
		"16",
		"-an",
		out,
	]);
	console.log("wrote", out, readdirSync(dir).length, "frames");
	return out;
}

const clips = [];

/** 1) Dwa auta lecą nad środkiem — orbita kamery. */
clips.push(
	await captureShot("aerial", (t) => {
		const ang = t * Math.PI * 0.85;
		const c0 = {
			x: -4 + t * 10,
			y: 8.5 - t * 1.2,
			z: -5 + t * 12,
		};
		const c1 = {
			x: 6 - t * 8,
			y: 7.2 + Math.sin(t * Math.PI) * 1.5,
			z: 5 - t * 6,
		};
		const ball = {
			x: 0.5 + t * 3,
			y: 8.0 - t * 0.5,
			z: 1 + t * 4,
		};
		const focus = {
			x: (c0.x + ball.x) * 0.5,
			y: (c0.y + ball.y) * 0.5,
			z: (c0.z + ball.z) * 0.5,
		};
		const R = 12;
		return {
			cars: [
				{
					i: 0,
					pos: c0,
					eul: {
						yaw: 0.55,
						pitch: -0.45 - t * 0.2,
						roll: 0.35 + t * 0.4,
					},
				},
				{
					i: 1,
					pos: c1,
					eul: {
						yaw: -2.1,
						pitch: 0.25,
						roll: -0.3 - t * 0.2,
					},
				},
			],
			ball: { pos: ball },
			cam: [
				focus.x + Math.cos(ang) * R,
				focus.y + 5.5,
				focus.z + Math.sin(ang) * R,
			],
			look: [focus.x, focus.y, focus.z],
		};
	}),
);

/** 2) Boost chase — auto pędzi do piłki. */
clips.push(
	await captureShot("boost", (t) => {
		const car = {
			x: -10 + t * 18,
			y: 0.45 + Math.sin(t * Math.PI) * 0.35,
			z: -24 + t * 28,
		};
		const ball = { x: 2 + t * 4, y: 1.4 + t * 0.8, z: -2 + t * 10 };
		const dx = ball.x - car.x;
		const dz = ball.z - car.z;
		const len = Math.hypot(dx, dz) || 1;
		return {
			cars: [
				{
					i: 0,
					pos: car,
					eul: { yaw: Math.atan2(dx, dz), pitch: 0.05 },
				},
				{
					i: 1,
					pos: { x: 10 - t * 4, y: 0.45, z: -4 + t * 6 },
					eul: { yaw: -1.0 },
				},
			],
			ball: { pos: ball },
			cam: [
				car.x - (dx / len) * 11,
				car.y + 3.2,
				car.z - (dz / len) * 11,
			],
			look: [
				car.x * 0.4 + ball.x * 0.6,
				1.4,
				car.z * 0.4 + ball.z * 0.6,
			],
		};
	}),
);

/** 3) Flip aerial. */
clips.push(
	await captureShot("flip", (t) => {
		const car = {
			x: 3 - t * 6,
			y: 9.5 - t * 2.5,
			z: 10 - t * 16,
		};
		const ball = {
			x: 0.5 - t * 2,
			y: 8 - t * 1.5,
			z: 3 - t * 8,
		};
		return {
			cars: [
				{
					i: 0,
					pos: car,
					eul: {
						yaw: -0.4,
						pitch: 0.6 + t * 1.4,
						roll: 0.5 + t * 1.6,
					},
				},
				{
					i: 1,
					pos: { x: -8 + t * 3, y: 0.45, z: 12 - t * 4 },
					eul: { yaw: 0.8 },
				},
			],
			ball: { pos: ball },
			cam: [12 - t * 2, 8 - t * 0.5, 16 - t * 4],
			look: [car.x, car.y, car.z],
		};
	}),
);

/** 4) Gol — aerial shot into net. */
{
	const zG = half - 1;
	clips.push(
		await captureShot("goal", (t) => {
			const car = {
				x: -2 + t * 1.5,
				y: 6.2 - t * 0.8,
				z: zG - 12 + t * 9,
			};
			const ball = {
				x: -0.3 + t * 0.2,
				y: 4.8 - t * 0.6,
				z: zG - 5 + t * 5.5,
			};
			return {
				cars: [
					{
						i: 0,
						pos: car,
						eul: {
							yaw: 0.05,
							pitch: -0.55 - t * 0.35,
							roll: 0.25,
						},
					},
					{
						i: 1,
						pos: { x: 5, y: 0.5, z: zG - 18 + t * 4 },
						eul: { yaw: 0.35 },
					},
				],
				ball: { pos: ball },
				cam: [-9 + t * 1.5, 5.8, zG - 16 + t * 3],
				look: [0, 3.5, zG + 0.5],
			};
		}),
	);
}

await page.evaluate(() => {
	window.__igniteBootClip = null;
	window.__igniteCaptureCamLock = false;
	window.__igniteCaptureFreezePhysics = false;
});
await browser.close();

const flash = join(WORK, "flash_white.mp4");
const hold = join(WORK, "hold_black.mp4");
run([
	"-f",
	"lavfi",
	"-i",
	"color=c=white:s=1920x1080:d=0.1:r=30",
	"-c:v",
	"libx264",
	"-pix_fmt",
	"yuv420p",
	"-an",
	flash,
]);
run([
	"-f",
	"lavfi",
	"-i",
	"color=c=black:s=1920x1080:d=0.7:r=30",
	"-c:v",
	"libx264",
	"-pix_fmt",
	"yuv420p",
	"-an",
	hold,
]);

const lst = join(WORK, "concat_motion.txt");
writeFileSync(
	lst,
	[...clips, flash, hold].map((p) => `file '${p}'`).join("\n") + "\n",
);
const finalTmp = join(WORK, "ignite_boot_cinematic_motion.mp4");
run([
	"-f",
	"concat",
	"-safe",
	"0",
	"-i",
	lst,
	"-c:v",
	"libx264",
	"-preset",
	"fast",
	"-crf",
	"15",
	"-pix_fmt",
	"yuv420p",
	"-movflags",
	"+faststart",
	"-an",
	finalTmp,
]);
copyFileSync(finalTmp, GAME);

const probe = spawnSync(
	"ffprobe",
	[
		"-v",
		"error",
		"-show_entries",
		"format=duration,size",
		"-of",
		"default=noprint_wrappers=1",
		GAME,
	],
	{ encoding: "utf8" },
);
console.log(probe.stdout);
console.log("GAME", GAME);
console.log("OK — boot: aerial / boost / flip / goal (keyframed)");
