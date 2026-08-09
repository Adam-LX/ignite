#!/usr/bin/env node
/**
 * Capture Ignite logo sting → public/assets/video/ignite_logo_sting.mp4
 *
 * Usage:
 *   node scripts/capture-logo-sting.mjs
 *   node scripts/capture-logo-sting.mjs --fps 30 --out path.mp4
 *
 * Requires: playwright chromium + ffmpeg on PATH
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const args = process.argv.slice(2);
function flag(name, fallback) {
	const i = args.indexOf(name);
	if (i >= 0 && args[i + 1]) return args[i + 1];
	return fallback;
}

const FPS = Number(flag("--fps", "30"));
const OUT =
	flag("--out", null) ??
	path.join(PUBLIC, "assets", "video", "ignite_logo_sting.mp4");
const PORT = Number(flag("--port", "5179"));

const MIME = {
	".html": "text/html; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".json": "application/json",
};

function contentType(filePath) {
	return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function startStaticServer() {
	return new Promise((resolve, reject) => {
		const server = createServer(async (req, res) => {
			try {
				const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
				let rel = urlPath === "/" ? "/promo/ignite-logo-sting.html" : urlPath;
				const filePath = path.normalize(path.join(PUBLIC, rel));
				if (!filePath.startsWith(PUBLIC)) {
					res.writeHead(403).end();
					return;
				}
				if (!existsSync(filePath)) {
					res.writeHead(404).end("not found");
					return;
				}
				res.writeHead(200, { "Content-Type": contentType(filePath) });
				createReadStream(filePath).pipe(res);
			} catch (err) {
				res.writeHead(500).end(String(err));
			}
		});
		server.listen(PORT, "127.0.0.1", () => resolve(server));
		server.on("error", reject);
	});
}

function runFfmpeg(frameDir, outPath, fps) {
	return new Promise((resolve, reject) => {
		const ff = spawn(
			"ffmpeg",
			[
				"-y",
				"-framerate",
				String(fps),
				"-i",
				path.join(frameDir, "frame_%05d.png"),
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				"-crf",
				"18",
				"-preset",
				"medium",
				"-movflags",
				"+faststart",
				outPath,
			],
			{ stdio: ["ignore", "inherit", "inherit"] },
		);
		ff.on("error", reject);
		ff.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited ${code}`));
		});
	});
}

const server = await startStaticServer();
const frameDir = path.join(tmpdir(), `ignite-logo-sting-${Date.now()}`);
await mkdir(frameDir, { recursive: true });
await mkdir(path.dirname(OUT), { recursive: true });

const url = `http://127.0.0.1:${PORT}/promo/ignite-logo-sting.html?export=1`;
console.info(`serving public/ → ${url}`);

const browser = await chromium.launch({
	executablePath:
		process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
		"/run/current-system/sw/bin/chromium",
	headless: true,
	args: ["--use-gl=angle", "--ignore-gpu-blocklist", "--disable-web-security"],
});

const page = await browser.newPage({
	viewport: { width: 1920, height: 1080 },
	deviceScaleFactor: 1,
});

await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForFunction(
	() =>
		document.documentElement.dataset.stingReady === "1" &&
		typeof window.__STING__?.setTime === "function",
	{ timeout: 30_000 },
);

const duration = await page.evaluate(() => window.__STING__.duration);
const totalFrames = Math.round(duration * FPS) + 1;
console.info(`capturing ${totalFrames} frames @ ${FPS}fps (${duration}s)`);

for (let i = 0; i < totalFrames; i++) {
	const t = i / FPS;
	await page.evaluate((sec) => window.__STING__.setTime(sec), t);
	const buf = await page.screenshot({ type: "png", fullPage: false });
	const name = `frame_${String(i).padStart(5, "0")}.png`;
	await writeFile(path.join(frameDir, name), buf);
	if (i % 30 === 0 || i === totalFrames - 1) {
		console.info(`  frame ${i + 1}/${totalFrames} (t=${t.toFixed(2)}s)`);
	}
}

await browser.close();
server.close();

console.info(`encoding → ${OUT}`);
await runFfmpeg(frameDir, OUT, FPS);
await rm(frameDir, { recursive: true, force: true });

const stat = await readFile(OUT);
console.info(`done: ${OUT} (${(stat.byteLength / 1024 / 1024).toFixed(2)} MiB)`);
