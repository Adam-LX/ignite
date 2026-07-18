/**
 * Render siatki aut (orient audit) → PNG + JSON.
 *   nix develop -c npx vite-node scripts/render-orient-audit.mjs
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(root, "public/assets/cars/.work/diag/orient");
const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.CHROME_PATH ??
	"/run/current-system/sw/bin/chromium";

mkdirSync(OUT, { recursive: true });

const server = await createServer({
	root,
	configFile: join(root, "vite.config.ts"),
	server: { port: 5188, strictPort: true },
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
	const page = await browser.newPage({ viewport: { width: 1760, height: 1100 } });
	const url = `http://127.0.0.1:5188/render-orient.html?t=${Date.now()}`;
	console.log("Render:", url);
	await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
	await page.waitForSelector('body[data-ready="1"]', { timeout: 180_000 });
	const results = await page.evaluate(() => (window).__orientResults);
	writeFileSync(join(OUT, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
	await page.screenshot({ path: join(OUT, "grid.png"), type: "png" });
	console.log("OK", join(OUT, "grid.png"));
	for (const r of results ?? []) {
		if (r?.dataUrl?.startsWith("data:image/png")) {
			const buf = Buffer.from(r.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
			writeFileSync(join(OUT, `${r.id}.png`), buf);
			console.log(" ", r.id, r.size, "under", r.underScore);
		} else {
			console.log(" ", r);
		}
	}
} finally {
	await browser.close();
	await server.close();
}
