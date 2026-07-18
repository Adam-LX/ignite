#!/usr/bin/env node
/** Render ikony aplikacji z modelu auta (Three.js + car.glb). */
import { createServer } from "vite";
import { chromium } from "playwright";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const carId = process.env.IGNITE_ICON_CAR ?? "";
const qs = carId ? `?carId=${encodeURIComponent(carId)}` : "";

const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.CHROME_PATH ??
	"/run/current-system/sw/bin/chromium";

const server = await createServer({
	root,
	configFile: join(root, "vite.config.ts"),
	server: { port: 5179, strictPort: true },
});
await server.listen();

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

try {
	const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
	const url = `http://127.0.0.1:5179/render-icon.html${qs}`;
	console.log(`Render: ${url}`);
	await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });
	await page.waitForSelector('body[data-icon-ready="1"]', { timeout: 180_000 });

	const dataUrl = await page.evaluate(
		() =>
			(window).__iconPngBase64,
	);
	if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png")) {
		const err = await page.evaluate(() => document.body.dataset.iconError ?? "");
		throw new Error(`Brak PNG z renderera${err ? `: ${err}` : ""}`);
	}

	const buf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
	const pngPath = join(root, "assets/icon.png");
	const publicDir = join(root, "public/assets");
	mkdirSync(publicDir, { recursive: true });
	writeFileSync(pngPath, buf);
	cpSync(pngPath, join(publicDir, "icon.png"));

	console.log(`OK — ${pngPath} (${buf.length} B)`);
} finally {
	await browser.close();
	await server.close();
}
