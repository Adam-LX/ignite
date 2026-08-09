/**
 * Snapshot meczu vs key-art mood (night film / bloom / emissive).
 *   CHROMIUM_PATH=/run/current-system/sw/bin/chromium node scripts/_probe-keyart-match.mjs
 */
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const OUT = join(process.cwd(), "test-results", "keyart-compare");
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
	],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on("console", (m) => {
	const t = m.text();
	if (/error|Error|TypeError|failed|FAIL/i.test(t)) logs.push(t.slice(0, 240));
});
page.on("pageerror", (e) => logs.push(`PAGEERR ${String(e).slice(0, 400)}`));

await page.addInitScript(() => {
	try {
		localStorage.setItem("ignite.seenBootCinematic.v1", "1");
	} catch {
		/* */
	}
});

const url = `${BASE}/?autostart=1v1&skipIntro=1&t=${Date.now()}`;
console.log("goto", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

try {
	await page.waitForFunction(
		() => (window.__igniteSession?.cars?.length ?? 0) >= 2,
		null,
		{ timeout: 180_000 },
	);
} catch (err) {
	const boot = await page.evaluate(() => ({
		body: document.body?.className,
		err: document.getElementById("error-msg")?.textContent,
		boot: document.getElementById("boot")?.innerText?.slice(0, 400),
		hasSession: !!window.__igniteSession,
	}));
	console.error("NO SESSION", err.message);
	console.error(boot);
	console.error("logs", logs.slice(-20));
	await page.screenshot({ path: join(OUT, "fail-boot.png") }).catch(() => {});
	await browser.close();
	process.exit(1);
}

await page.waitForTimeout(3000);

const probe = await page.evaluate(() => {
	const r = window.__igniteMatchDeps?.renderer;
	const s = window.__igniteSession;
	let ambientI = null;
	let ambientHex = null;
	let hemiI = null;
	const scene = r?.threeJSScene ?? r?.scene;
	scene?.traverse?.((o) => {
		if (o.isAmbientLight && o.name === "arenaAmbient") {
			ambientI = o.intensity;
			ambientHex = o.color?.getHex?.();
		}
		if (o.isHemisphereLight && o.name === "arenaHemisphere") {
			hemiI = o.intensity;
		}
	});
	let overlayEm = null;
	scene?.traverse?.((o) => {
		if (o.name === "pitchVectorOverlay" && o.material) {
			overlayEm = o.material.emissiveIntensity ?? null;
		}
	});
	return {
		cars: s?.cars?.length ?? 0,
		exposure: r?.threeJSRenderer?.toneMappingExposure ?? null,
		ambientI,
		ambientHex: ambientHex != null ? `#${ambientHex.toString(16).padStart(6, "0")}` : null,
		hemiI,
		overlayEm,
		logsTail: null,
	};
});

console.log("probe", JSON.stringify(probe, null, 2));
writeFileSync(join(OUT, "probe.json"), JSON.stringify({ probe, logs: logs.slice(-30) }, null, 2));

const shot = join(OUT, "match-night.png");
await page.screenshot({ path: shot, type: "png" });
try {
	copyFileSync(
		join(process.cwd(), "public/assets/ui/menu/playlists/1v1.webp"),
		join(OUT, "keyart-1v1.webp"),
	);
} catch {
	/* */
}
console.log("wrote", shot);
await browser.close();
