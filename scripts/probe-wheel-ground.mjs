#!/usr/bin/env node
/**
 * Probe: opony nad murawą po settle.
 *   node scripts/probe-wheel-ground.mjs
 * Exit 0 = PASS, 1 = FAIL.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-results", "wheel-ground");
const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	"/run/current-system/sw/bin/chromium";
const VITE = (process.env.IGNITE_VITE_URL || "http://127.0.0.1:5173").replace(
	/\?.*$/,
	"",
);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
	executablePath: CHROMIUM,
	headless: true,
	args: [
		"--use-gl=angle",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
		"--no-sandbox",
		"--disable-dev-shm-usage",
		"--autoplay-policy=no-user-gesture-required",
	],
});

const context = await browser.newContext({
	viewport: { width: 1600, height: 900 },
});
const page = await context.newPage();
page.setDefaultTimeout(180_000);
await page.addInitScript(() => {
	try {
		localStorage.setItem("ignite.seenBootCinematic.v1", "1");
		localStorage.setItem("ignite.graphicsQuality", "medium");
	} catch {
		/* */
	}
});

const url = `${VITE}/?autostart=1v1&skipIntro=1&graphics=medium&t=${Date.now()}`;
console.log("goto", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

try {
	await page.waitForFunction(
		() => (window.__igniteSession?.cars?.length ?? 0) >= 1,
		{ timeout: 180_000 },
	);
} catch (err) {
	console.error("NO SESSION", err.message);
	await page.screenshot({ path: join(OUT, "no-session.png") }).catch(() => {});
	await browser.close();
	process.exit(1);
}

await page.waitForTimeout(2000);
await page.evaluate(() => {
	const s = window.__igniteSession;
	s?.match?.setCountdownHold?.(false);
	s?.match?.forceStartPlaying?.();
});
/** Settle hover — sprężyny + kilka ticków fizyki. */
await page.waitForTimeout(2000);

const metrics = await page.evaluate(() => {
	const s = window.__igniteSession;
	if (!s?.humanCar) {
		return { ok: false, reason: "no-human" };
	}
	const player = s.humanCar.player;
	const centerY = player.getPosition().y;
	const root = player.visualRoot;
	root.updateMatrixWorld(true);

	const hubNames = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"];
	let tireMin = Infinity;
	const _v = { x: 0, y: 0, z: 0 };

	const accumulateMeshMinY = (obj) => {
		obj.traverse((node) => {
			if (!node.isMesh || !node.visible || !node.geometry) return;
			const geo = node.geometry;
			if (!geo.boundingBox) geo.computeBoundingBox();
			const bb = geo.boundingBox;
			if (!bb) return;
			const m = node.matrixWorld.elements;
			const corners = [
				[bb.min.x, bb.min.y, bb.min.z],
				[bb.min.x, bb.min.y, bb.max.z],
				[bb.min.x, bb.max.y, bb.min.z],
				[bb.min.x, bb.max.y, bb.max.z],
				[bb.max.x, bb.min.y, bb.min.z],
				[bb.max.x, bb.min.y, bb.max.z],
				[bb.max.x, bb.max.y, bb.min.z],
				[bb.max.x, bb.max.y, bb.max.z],
			];
			for (const [x, y, z] of corners) {
				_v.y = m[1] * x + m[5] * y + m[9] * z + m[13];
				tireMin = Math.min(tireMin, _v.y);
			}
		});
	};

	for (const name of hubNames) {
		const hub = root.getObjectByName(name);
		if (!hub) continue;
		const rim = hub.getObjectByName(`cosmetic_rim_${name}`) ?? hub;
		accumulateMeshMinY(rim);
	}

	const surface = 0.05;
	const gap = tireMin - surface;
	return {
		ok: true,
		carId: root.userData?.carId ?? null,
		centerY: +centerY.toFixed(4),
		tireMinY: Number.isFinite(tireMin) ? +tireMin.toFixed(4) : null,
		surface,
		gap: Number.isFinite(tireMin) ? +gap.toFixed(4) : null,
		pass: Number.isFinite(tireMin) && gap >= 0.04,
	};
});

await page.screenshot({
	path: join(OUT, `settle-${metrics.carId ?? "car"}.png`),
});
writeFileSync(join(OUT, "metrics.json"), JSON.stringify(metrics, null, 2));

console.log(JSON.stringify(metrics, null, 2));
await browser.close();

if (!metrics.ok || !metrics.pass) {
	console.error("FAIL wheel-ground probe");
	process.exit(1);
}
console.log("PASS wheel-ground probe");
process.exit(0);
