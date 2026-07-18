/**
 * Screenshoty garażu — ten sam stack co render-app-icon (Chromium + SwiftShader).
 *   nix develop -c npx vite-node scripts/screenshot-garage-cars.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/assets/cars/.work/diag/screens");
const BASE = (
	process.env.IGNITE_VITE_URL || "http://127.0.0.1:5173"
).replace(/\?.*$/, "");
const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.CHROME_PATH ??
	"/run/current-system/sw/bin/chromium";

const CARS = (process.env.IGNITE_SHOT_CARS ||
	"muscle,truck,hatch,buggy,blade,phantom,bruiser,sleek")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

mkdirSync(OUT, { recursive: true });

const health = await fetch(BASE).then((r) => r.ok).catch(() => false);
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
		"--no-sandbox",
		"--disable-dev-shm-usage",
	],
});

const page = await browser.newPage({
	viewport: { width: 1600, height: 900 },
});

const report = [];

for (const car of CARS) {
	const url = `${BASE}/?garageAudit=1&car=${encodeURIComponent(car)}&t=${Date.now()}`;
	console.log(`→ ${car}`);
	await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
	await page.waitForFunction(
		() => document.body.classList.contains("garage-open"),
		null,
		{ timeout: 120_000 },
	);
	await page.waitForTimeout(3500);
	const file = join(OUT, `${car}.png`);
	await page.screenshot({ path: file, type: "png" });
	const st = await page.evaluate(() => {
		const canvas = document.querySelector("canvas");
		return {
			garageOpen: document.body.classList.contains("garage-open"),
			hasCanvas: !!canvas,
			canvasW: canvas?.width ?? 0,
			canvasH: canvas?.height ?? 0,
		};
	});
	report.push({ car, file, ...st });
	console.log(`  saved ${file}`, st);
}

writeFileSync(
	join(OUT, "index.json"),
	`${JSON.stringify({ at: new Date().toISOString(), report }, null, 2)}\n`,
);
await browser.close();
console.log(`OK — ${report.length} screenów w ${OUT}`);
