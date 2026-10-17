#!/usr/bin/env node
/** Capture window.__ignitePrematchHitch after autostart prematch. */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.IGNITE_VITE_URL || "http://127.0.0.1:5173").replace(/\?.*$/, "");
const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.CHROME_PATH ??
	"/run/current-system/sw/bin/chromium";
const SHOW_SEC = process.env.IGNITE_SHOW_SEC || "8";
const SKIP = process.env.IGNITE_SKIP_SHOW === "1";
const USE_SW = process.env.IGNITE_SWIFTSHADER !== "0";
const OUT = join(process.cwd(), "data", "hitch-probe");
mkdirSync(OUT, { recursive: true });

const health = await fetch(BASE).then((r) => r.ok).catch(() => false);
if (!health) {
	console.error(`Brak Vite na ${BASE}`);
	process.exit(1);
}

const glArgs = USE_SW
	? [
			"--use-gl=angle",
			"--use-angle=swiftshader",
			"--enable-unsafe-swiftshader",
		]
	: [
			"--ignore-gpu-blocklist",
			"--enable-gpu",
			"--use-gl=angle",
			"--use-angle=gl",
		];

console.log("chromium", CHROMIUM, "swiftshader", USE_SW);
const browser = await chromium.launch({
	headless: true,
	executablePath: CHROMIUM,
	args: [
		...glArgs,
		"--no-sandbox",
		"--disable-dev-shm-usage",
		"--autoplay-policy=no-user-gesture-required",
	],
});
const context = await browser.newContext({
	viewport: { width: 1280, height: 720 },
	deviceScaleFactor: 1,
});
const page = await context.newPage();
await page.addInitScript(() => {
	try {
		localStorage.setItem("ignite.seenBootCinematic.v1", "1");
		localStorage.setItem("ignite.graphicsQuality", "low");
		localStorage.setItem("ignite-hitch-probe", "1");
	} catch {}
});

const hitchLogs = [];
page.on("console", (msg) => {
	const t = msg.text();
	if (t.includes("[hitchProbe]")) {
		hitchLogs.push(t);
		console.log(t);
	}
});

const qs = new URLSearchParams({
	autostart: "1v1",
	skipIntro: "1",
	hitchProbe: "1",
	graphics: "low",
	t: String(Date.now()),
});
if (SKIP) qs.set("skipShow", "1");
else qs.set("showSec", SHOW_SEC);
const url = `${BASE}/?${qs}`;
console.log("goto", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

const t0 = Date.now();
let dump = null;
const maxSec = SKIP ? 25 : Number(SHOW_SEC) + 35;
for (let i = 0; i < Math.ceil(maxSec * 2); i++) {
	await page.waitForTimeout(500);
	dump = await page
		.evaluate(() => {
			const g = window;
			const hitch =
				(typeof g.__igniteGetPrematchHitch === "function"
					? g.__igniteGetPrematchHitch()
					: null) ?? g.__ignitePrematchHitch ?? null;
			return {
				hitch,
				kickoff: document.getElementById("kickoff-banner")?.textContent?.trim() ?? "",
				prematchVisible: !!document.querySelector(".prematch-show--visible"),
			};
		})
		.catch(() => null);
	const elapsed = (Date.now() - t0) / 1000;
	if (i % 4 === 0) {
		console.log(
			`[${elapsed.toFixed(1)}s] events=${dump?.hitch?.events?.length ?? "null"} phase=${dump?.hitch?.phase ?? "-"} prematch=${dump?.prematchVisible}`,
		);
	}
	if (
		dump?.hitch &&
		(dump.hitch.phase === "countdown" ||
			(dump.hitch.events?.length > 0 && !dump.prematchVisible && elapsed > Number(SHOW_SEC) + 2))
	) {
		await page.waitForTimeout(2000);
		dump = await page.evaluate(() => ({
			hitch:
				(typeof window.__igniteGetPrematchHitch === "function"
					? window.__igniteGetPrematchHitch()
					: null) ?? window.__ignitePrematchHitch ?? null,
			kickoff: document.getElementById("kickoff-banner")?.textContent?.trim() ?? "",
		}));
		break;
	}
	if (elapsed > maxSec) break;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const tag = SKIP ? "skipShow" : `show${SHOW_SEC}`;
const outPath = join(OUT, `dump-${tag}-${stamp}.json`);
const payload = {
	capturedAt: new Date().toISOString(),
	url,
	swiftshader: USE_SW,
	hitchLogs,
	dump: dump?.hitch ?? null,
	kickoff: dump?.kickoff ?? null,
};
writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log("WROTE", outPath);
if (payload.dump) {
	console.log("phase", payload.dump.phase);
	console.log("byPhase", JSON.stringify(payload.dump.byPhase, null, 2));
	console.log("suspects", payload.dump.suspects);
	console.log("frameStats", JSON.stringify(payload.dump.frameStats));
	console.log(
		"topEvents",
		JSON.stringify(
			[...(payload.dump.events || [])].sort((a, b) => b.ms - a.ms).slice(0, 15),
			null,
			2,
		),
	);
} else {
	console.error("NO DUMP");
}
await browser.close();
process.exit(payload.dump ? 0 : 2);
