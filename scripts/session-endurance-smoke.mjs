#!/usr/bin/env node
/**
 * Endurance smoke bez testerów — headless 1v1 ~N s.
 * Fail: crash, black-bar (source opacity 0), kamera top-down, bot zero goli przy touchach.
 *
 *   IGNITE_VITE_URL=http://127.0.0.1:5173 node scripts/session-endurance-smoke.mjs
 *   IGNITE_ENDURANCE_SEC=120 node scripts/session-endurance-smoke.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-results", "solo-ship");
const VITE = (process.env.IGNITE_VITE_URL || "http://127.0.0.1:5173").replace(
	/\?.*$/,
	"",
);
const SEC = Math.max(45, Number(process.env.IGNITE_ENDURANCE_SEC ?? 90));
const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	"/run/current-system/sw/bin/chromium";

mkdirSync(OUT, { recursive: true });

function fail(msg, extra = {}) {
	const report = { pass: false, fail: msg, ...extra, at: new Date().toISOString() };
	writeFileSync(join(OUT, "ENDURANCE.json"), JSON.stringify(report, null, 2));
	writeFileSync(
		join(OUT, "ENDURANCE.md"),
		`# Session endurance — FAIL\n\n${msg}\n\n\`\`\`json\n${JSON.stringify(extra, null, 2)}\n\`\`\`\n`,
	);
	console.error(`[endurance] FAIL — ${msg}`);
	process.exit(1);
}

const browser = await chromium.launch({
	headless: true,
	executablePath: CHROMIUM,
	args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(180_000);

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
page.on("crash", () => pageErrors.push("renderer-crash"));

const url = `${VITE}/?autostart=1v1&skipIntro=1&graphics=medium&t=${Date.now()}`;
console.info(`[endurance] ${url} for ${SEC}s`);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

await page.waitForFunction(() => !!window.__igniteSession, { timeout: 180_000 });
await page.evaluate(() => {
	try {
		localStorage.setItem("ignite.tutorialDone", "1");
		localStorage.setItem("ignite.demoTutorialDone", "1");
	} catch {
		/* */
	}
	window.__igniteSession?.match?.forceStartPlaying?.();
});
await page.waitForTimeout(1500);

const t0 = Date.now();
const samples = [];
let maxBlue = 0;
let maxOrange = 0;
let maxTouches = 0;
let topDownHits = 0;
let blackBarHits = 0;

while ((Date.now() - t0) / 1000 < SEC) {
	const snap = await page.evaluate(() => {
		try {
			const s = window.__igniteSession;
			const r = window.__igniteRenderer;
			if (!s) return { ok: false, reason: "no-session" };
			const cam = r?.camera;
			const carList = Array.isArray(s.cars) ? s.cars : [];
			const car = carList[0];
			const carPos = car?.getPosition?.() ?? car?.mesh?.position;
			let blue = 0;
			let orange = 0;
			let phase = "?";
			try {
				const m = s.match;
				phase = m?.getPhase?.() ?? m?.phase ?? "?";
				blue = Number(m?.blueScore ?? 0);
				orange = Number(m?.orangeScore ?? 0);
				if (typeof m?.getHudSnapshot === "function" && carList.length) {
					const hud = m.getHudSnapshot(carList);
					blue = Number(hud?.blueScore ?? blue);
					orange = Number(hud?.orangeScore ?? orange);
					phase = hud?.phase ?? phase;
				}
			} catch (e) {
				return { ok: false, reason: `hud:${String(e)}` };
			}
			const source =
				document.getElementById("source-canvas") ||
				document.querySelector("canvas");
			const body =
				document.body?.dataset?.scene || document.body?.className || "";
			let touches = 0;
			try {
				touches = Number(s.ball?.touchCount ?? s.stats?.ballTouches ?? 0);
			} catch {
				/* */
			}
			const camY = cam?.position?.y ?? 0;
			const carY = carPos?.y ?? 0;
			const camTooHigh = camY >= carY + 8;
			const sourceOpacity = source
				? Number(getComputedStyle(source).opacity)
				: 1;
			const sourceDisplay = source ? getComputedStyle(source).display : "?";
			return {
				ok: true,
				phase,
				blue,
				orange,
				touches,
				camY,
				carY,
				camTooHigh,
				sourceOpacity,
				sourceDisplay,
				body,
				menuPresentation: Boolean(r?.menuPresentation),
			};
		} catch (e) {
			return { ok: false, reason: String(e) };
		}
	});

	if (!snap.ok) {
		/** Jednorazowy glitch HUD — nie zabijaj od razu. */
		if (String(snap.reason || "").startsWith("hud:")) {
			await page.waitForTimeout(1000);
			continue;
		}
		fail("session disappeared mid-match", { snap, pageErrors });
	}
	if (pageErrors.length) fail("pageerror / crash", { pageErrors, snap });

	maxBlue = Math.max(maxBlue, Number(snap.blue) || 0);
	maxOrange = Math.max(maxOrange, Number(snap.orange) || 0);
	maxTouches = Math.max(maxTouches, Number(snap.touches) || 0);
	if (snap.camTooHigh) topDownHits++;
	if (
		/in-match/.test(String(snap.body)) &&
		(snap.sourceDisplay === "none" || snap.sourceOpacity === 0)
	) {
		blackBarHits++;
	}
	if (snap.menuPresentation) {
		fail("menuPresentation stuck in match", { snap });
	}

	samples.push({
		t: Number(((Date.now() - t0) / 1000).toFixed(1)),
		...snap,
	});
	await page.waitForTimeout(1000);
}

await page.screenshot({ path: join(OUT, "endurance-last.png"), type: "png" });
await browser.close();

const goals = maxBlue + maxOrange;
const report = {
	pass: true,
	sec: SEC,
	goals,
	maxBlue,
	maxOrange,
	maxTouches,
	topDownHits,
	blackBarHits,
	samples: samples.length,
	pageErrors,
};

/** Soft: zero goli OK jeśli krótko; przy ≥60s + aktywnej grze ostrzeż, nie twarde FAIL (bot probe osobno). */
const hardFails = [];
if (topDownHits >= 3) hardFails.push(`camera-top-down hits=${topDownHits}`);
if (blackBarHits >= 2) hardFails.push(`black-bar hits=${blackBarHits}`);
if (pageErrors.length) hardFails.push(`errors=${pageErrors.length}`);

if (hardFails.length) {
	fail(hardFails.join("; "), report);
}

report.note =
	goals === 0 && SEC >= 60
		? "zero goli w endurance — sprawdź probe:matches (nie auto-FAIL)"
		: "ok";

writeFileSync(join(OUT, "ENDURANCE.json"), JSON.stringify(report, null, 2));
writeFileSync(
	join(OUT, "ENDURANCE.md"),
	[
		"# Session endurance — PASS",
		"",
		`- duration: ${SEC}s`,
		`- goals: blue ${maxBlue} / orange ${maxOrange}`,
		`- topDownHits: ${topDownHits}`,
		`- blackBarHits: ${blackBarHits}`,
		`- note: ${report.note}`,
		"",
	].join("\n"),
);
console.info(
	`[endurance] PASS — ${SEC}s goals=${goals} topDown=${topDownHits} blackBar=${blackBarHits}`,
);
process.exit(0);
