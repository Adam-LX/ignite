#!/usr/bin/env node
/** Screenshot menu — wymaga działającego `npm run dev` na porcie 5173. */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "screenshots");
const url = process.env.MENU_URL ?? "http://127.0.0.1:5173/?mode=1v1";

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

try {
	await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
	await page.waitForSelector("#main-menu:not(.hidden)", { timeout: 120_000 });
	await page.waitForTimeout(3500);

	const stamp = new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\..+/, "")
		.replace("T", "-");
	const fullPath = path.join(outDir, `menu-wypas-${stamp}.png`);
	const menuPath = path.join(outDir, `menu-wypas-ui-${stamp}.png`);

	await page.screenshot({ path: fullPath, fullPage: false });
	const menu = page.locator("#main-menu");
	if (await menu.count()) {
		await menu.screenshot({ path: menuPath });
	}

	console.log(`OK: ${fullPath}`);
	if (await menu.count()) console.log(`OK: ${menuPath}`);
} finally {
	await browser.close();
}
