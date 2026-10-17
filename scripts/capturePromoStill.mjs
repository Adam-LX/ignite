#!/usr/bin/env node
/**
 * Promo still capture — high-sample path (nie live path-trace).
 * Używa Chromium + istniejącego meczu / menu do klatek marketingowych.
 *
 * Usage:
 *   node scripts/capturePromoStill.mjs [url] [out.png]
 * Default: http://127.0.0.1:5173 → test-results/keyart-compare/promo-still.png
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:5173/?graphics=high";
const out =
	process.argv[3] ??
	path.join("test-results", "keyart-compare", "promo-still.png");

await mkdir(path.dirname(out), { recursive: true });

const browser = await chromium.launch({
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
		"/run/current-system/sw/bin/chromium",
	headless: true,
	args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
});

const page = await browser.newPage({
	viewport: { width: 1920, height: 1080 },
	deviceScaleFactor: 2,
});

await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForTimeout(4500);
const buf = await page.screenshot({ type: "png", fullPage: false });
await writeFile(out, buf);
await browser.close();
console.info(`promo still → ${out}`);
