#!/usr/bin/env node
/**
 * Live probe: kamera podczas countdown 5→1.
 * PASS (Gemini 2026-07-24): |ndc.x|≤0.12, ndc.y∈[-0.5,0.12], dist∈[4.5,8.5],
 * camY≤carY+3.2, pitch≥−18°.
 *
 *   node scripts/probe-countdown-cam.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-results", "chase-camera");
const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	"/run/current-system/sw/bin/chromium";
const VITE = (process.env.IGNITE_VITE_URL || "http://127.0.0.1:5173").replace(
	/\?.*$/,
	"",
);

mkdirSync(OUT, { recursive: true });

function judge(a) {
	const fails = [];
	if (!a || a.reason === "no-session") return { pass: false, fails: ["no-session"] };
	const ax = Math.abs(a.ndc?.x ?? 99);
	const ay = a.ndc?.y ?? 99;
	const dist = a.dist ?? 99;
	const camY = a.cam?.y ?? 99;
	const carY = a.car?.y ?? 0;
	const look = a.lookDir;
	let pitchDeg = 0;
	if (look && Number.isFinite(look.x)) {
		const horiz = Math.hypot(look.x, look.z) || 1e-6;
		pitchDeg = (Math.atan2(look.y, horiz) * 180) / Math.PI;
	}
	/** Gemini: ndc.x=0 kłamie — wymagaj bliskiego TPP + płytki pitch. */
	if (ax > 0.12) fails.push(`ndc.x=${a.ndc.x.toFixed(3)}`);
	if (ay < -0.5 || ay > 0.12) fails.push(`ndc.y=${ay.toFixed(3)}`);
	if (dist < 4.5 || dist > 8.5) fails.push(`dist=${dist.toFixed(2)}`);
	if (camY > carY + 3.2) fails.push(`camTooHigh=${camY.toFixed(2)}`);
	if (pitchDeg < -18) fails.push(`pitch=${pitchDeg.toFixed(1)}`);
	return { pass: fails.length === 0, fails };
}

const browser = await chromium.launch({
	headless: true,
	executablePath: CHROMIUM,
	args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(180_000);

await page.goto(`${VITE}/?autostart=1v1`, {
	waitUntil: "domcontentloaded",
	timeout: 120_000,
});
await page.waitForFunction(() => window.__igniteSession, { timeout: 180_000 });

const byTick = new Map();
for (let i = 0; i < 80; i++) {
	await page.waitForTimeout(150);
	const row = await page.evaluate(() => {
		const s = window.__igniteSession;
		const audit = window.__igniteCameraAudit?.();
		const hud = s?.match?.getHudSnapshot?.(s.cars);
		return {
			phase: s?.match?.getPhase?.(),
			kickoffTick: hud?.kickoffTick ?? null,
			blend: window.__igniteRenderer?.countdownCamBlend,
			...audit,
		};
	});
	if (row.kickoffTick != null && !byTick.has(row.kickoffTick)) {
		byTick.set(row.kickoffTick, row);
		const shot = join(OUT, `countdown-tick-${row.kickoffTick}.png`);
		await page.screenshot({ path: shot, type: "png", timeout: 10_000 }).catch(() => {});
		const v = judge(row);
		console.log(
			`[tick ${row.kickoffTick}] ${v.pass ? "PASS" : "FAIL"} dist=${row.dist?.toFixed?.(2)} ndc=(${row.ndc?.x?.toFixed?.(3)},${row.ndc?.y?.toFixed?.(3)}) fails=${v.fails.join("|") || "—"}`,
		);
	}
	if (row.phase === "playing" && row.kickoffTick == null && byTick.size >= 3) break;
}

await browser.close();

const ticks = [...byTick.entries()].sort((a, b) => b[0] - a[0]);
const verdicts = ticks.map(([t, row]) => ({ tick: t, ...judge(row), row }));
const pass = verdicts.length > 0 && verdicts.every((v) => v.pass);
writeFileSync(
	join(OUT, "countdown-probe.json"),
	JSON.stringify({ pass, verdicts }, null, 2),
);
console.log(pass ? "COUNTDOWN_CAM_PASS" : "COUNTDOWN_CAM_FAIL");
process.exit(pass ? 0 : 1);
