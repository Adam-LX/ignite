#!/usr/bin/env node
/**
 * Capture 3 dramatic match stills for SM FramePack I2V boot cinematic.
 *   CHROMIUM_PATH=... node scripts/capture-boot-cinematic-stills.mjs
 *
 * Shots: aerial flyby · boost chase · goal strike
 */
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { chromium } from "playwright";

const OUT = join(homedir(), "StabilityMatrix", "Images", "IgniteBoot");
mkdirSync(OUT, { recursive: true });
const BASE = (process.env.IGNITE_VITE_URL || "http://127.0.0.1:5173").replace(
	/\?.*$/,
	"",
);
const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.CHROME_PATH ??
	"/run/current-system/sw/bin/chromium";

const health = await fetch(BASE)
	.then((r) => r.ok)
	.catch(() => false);
if (!health) {
	console.error(`Brak Vite na ${BASE}`);
	process.exit(1);
}

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
	viewport: { width: 1920, height: 1080 },
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
	await page.screenshot({ path: join(OUT, "fail-boot.png") }).catch(() => {});
	await browser.close();
	process.exit(1);
}

await page.evaluate(() => {
	const hide = (sel) => {
		document.querySelectorAll(sel).forEach((el) => {
			el.style.visibility = "hidden";
			el.style.opacity = "0";
		});
	};
	hide(
		"#hud, #boost-panel, #speed-panel, #cam-indicator, #supersonic-banner, #power-shot-banner, #demolish-banner, #epic-save-banner, #post-hit-banner, #error, .social-fab, #menu, #dev-free-cam-badge",
	);
	const s = window.__igniteSession;
	s?.match?.setCountdownHold?.(false);
	s?.match?.forceStartPlaying?.();
	window.__igniteFreeCam?.setActive?.(false);
});
await page.waitForTimeout(2000);

async function holdAndShot(name, setup) {
	const info = await page.evaluate((cfg) => {
		const THREE = window.__THREE;
		const s = window.__igniteSession;
		const ball = window.__igniteBall;
		const r = window.__igniteMatchDeps?.renderer ?? window.__igniteRenderer;
		const cam = r?.threeJSCamera;
		if (!THREE || !s || !cam) return { ok: false, why: "missing" };

		window.__igniteCaptureCamLock = true;
		window.__igniteCaptureFreezePhysics = true;
		window.__igniteFreeCam?.setActive?.(false);

		const poseCar = (carLike, pos, eul, linvel) => {
			const player = carLike?.player ?? carLike;
			const body = player?.rapierRigidBody;
			if (!body) return;
			body.setTranslation(pos, true);
			body.setLinvel(linvel ?? { x: 0, y: 0, z: 0 }, true);
			body.setAngvel({ x: 0, y: 0, z: 0 }, true);
			const q = new THREE.Quaternion().setFromEuler(
				new THREE.Euler(
					eul?.pitch ?? 0,
					eul?.yaw ?? 0,
					eul?.roll ?? 0,
					"YXZ",
				),
			);
			body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
			body.wakeUp?.();
			player.syncWithRigidBody?.();
			if (player.threeJSGroup) {
				player.threeJSGroup.position.set(pos.x, pos.y, pos.z);
				player.threeJSGroup.quaternion.copy(q);
				player.threeJSGroup.updateMatrixWorld(true);
			}
		};

		const apply = () => {
			for (const c of cfg.cars) {
				poseCar(s.cars[c.i], c.pos, c.eul, c.vel);
			}
			if (cfg.ball && ball?.rapierRigidBody) {
				ball.rapierRigidBody.setTranslation(cfg.ball.pos, true);
				ball.rapierRigidBody.setLinvel(
					cfg.ball.vel ?? { x: 0, y: 0, z: 0 },
					true,
				);
				ball.rapierRigidBody.setAngvel(
					cfg.ball.ang ?? { x: 0, y: 0, z: 0 },
					true,
				);
				ball.syncWithRigidBody?.();
			}
			cam.position.set(cfg.cam[0], cfg.cam[1], cfg.cam[2]);
			cam.up.set(0, 1, 0);
			cam.lookAt(cfg.look[0], cfg.look[1], cfg.look[2]);
			cam.updateMatrixWorld(true);
			cam.updateProjectionMatrix();
		};

		apply();
		if (window.__igniteBootHoldId) {
			cancelAnimationFrame(window.__igniteBootHoldId);
		}
		const tick = () => {
			apply();
			window.__igniteBootHoldId = requestAnimationFrame(tick);
		};
		window.__igniteBootHoldId = requestAnimationFrame(tick);

		const p0 = s.cars?.[0]?.player?.getPosition?.();
		const ndc = p0
			? (() => {
					const v = new THREE.Vector3(p0.x, p0.y, p0.z).project(cam);
					return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) };
				})()
			: null;
		return {
			ok: true,
			car0: p0 ? { x: p0.x, y: p0.y, z: p0.z } : null,
			ndc,
			cam: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
		};
	}, setup);

	console.log(name, "hold", info);
	await page.waitForTimeout(1100);
	const path = join(OUT, `${name}.png`);
	await page.screenshot({ path, type: "png" });
	console.log("wrote", path);

	await page.evaluate(() => {
		if (window.__igniteBootHoldId) {
			cancelAnimationFrame(window.__igniteBootHoldId);
			window.__igniteBootHoldId = 0;
		}
		window.__igniteCaptureCamLock = false;
		window.__igniteCaptureFreezePhysics = false;
	});
}

const half = await page.evaluate(
	() =>
		window.__igniteArenaHalfLength ??
		window.__igniteMatchDeps?.arena?.HALF_LENGTH ??
		51.2,
);
console.log("half", half);

await holdAndShot("kf_arena", {
	cars: [
		{
			i: 0,
			pos: { x: -2, y: 6.5, z: -2 },
			eul: { yaw: 0.7, pitch: -0.55, roll: 0.35 },
			vel: { x: 0, y: 0, z: 0 },
		},
		{
			i: 1,
			pos: { x: 4.2, y: 5.4, z: 3.5 },
			eul: { yaw: -2.1, pitch: 0.35, roll: -0.25 },
			vel: { x: 0, y: 0, z: 0 },
		},
	],
	ball: {
		pos: { x: 0.4, y: 6.2, z: 1.2 },
		vel: { x: 0, y: 0, z: 0 },
	},
	/** Blisko latających aut — czytelne w intro. */
	cam: [-7.5, 7.2, -6.5],
	look: [0.5, 5.8, 1],
});

await holdAndShot("kf_boost", {
	cars: [
		{
			i: 0,
			pos: { x: -4, y: 0.42, z: -12 },
			eul: { yaw: 0.2, pitch: 0.04 },
			vel: { x: 0, y: 0, z: 0 },
		},
		{
			i: 1,
			pos: { x: 7, y: 0.42, z: -4 },
			eul: { yaw: -1.0 },
			vel: { x: 0, y: 0, z: 0 },
		},
	],
	ball: {
		pos: { x: 0.5, y: 1.35, z: -2 },
		vel: { x: 0, y: 0, z: 0 },
	},
	cam: [-7.5, 2.2, -18],
	look: [1, 1.0, -2],
});

{
	const zGoal = half - 1.2;
	await holdAndShot("kf_strike", {
		cars: [
			{
				i: 0,
				pos: { x: -1.2, y: 5.0, z: zGoal - 8 },
				eul: { yaw: 0.05, pitch: -0.75, roll: 0.28 },
				vel: { x: 0, y: 0, z: 0 },
			},
			{
				i: 1,
				pos: { x: 4, y: 0.45, z: zGoal - 16 },
				eul: { yaw: 0.35 },
				vel: { x: 0, y: 0, z: 0 },
			},
		],
		ball: {
			pos: { x: -0.2, y: 3.2, z: zGoal - 1.8 },
			vel: { x: 0, y: 0, z: 0 },
		},
		cam: [-6.5, 4.6, zGoal - 11],
		look: [0, 3.0, zGoal + 0.5],
	});
}

for (const name of ["kf_arena", "kf_boost", "kf_strike"]) {
	const p = join(OUT, `${name}.png`);
	if (!existsSync(p)) {
		console.error("MISSING", p);
		process.exit(1);
	}
}

console.log("OK stills →", OUT);
await browser.close();
