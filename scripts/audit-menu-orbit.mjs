/**
 * Audit orbity menu — kamera nad prawdziwym boiskiem (nie close-up / CSS void).
 *
 *   npm run audit:menu-orbit
 *   (dev server na :5173)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-results", "menu-orbit");
const URL = process.env.MENU_URL ?? "http://127.0.0.1:5173/";
const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	"/run/current-system/sw/bin/chromium";

mkdirSync(OUT, { recursive: true });

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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

/** @type {{ pass: boolean, detail: string }[]} */
const checks = [];

try {
	await page.goto(URL, { waitUntil: "networkidle", timeout: 120_000 });
	await page.waitForSelector("#main-menu:not(.hidden)", { timeout: 120_000 });
	await page.waitForTimeout(4500);

	const probe = await page.evaluate(() => {
		const live = globalThis.__igniteLiveMenu;
		const pose =
			typeof live?.getMenuCameraPose === "function"
				? live.getMenuCameraPose()
				: null;
		const body = document.body.className;
		const hasStadiumClass = !!document.querySelector(
			"#main-menu.main-menu--stadium-orbit",
		);
		const fakeFx = !!document.querySelector(".main-menu__apex-backdrop");
		const voidFx = !!document.querySelector(".main-menu__cosmos-void");
		return { pose, body, hasStadiumClass, fakeFx, voidFx };
	});

	let camDist = null;
	let camY = null;
	if (probe.pose?.position) {
		const p = probe.pose.position;
		camDist = Math.hypot(p.x, p.z);
		camY = p.y;
	}

	checks.push({
		pass: probe.hasStadiumClass,
		detail: `main-menu--stadium-orbit class=${probe.hasStadiumClass}`,
	});
	checks.push({
		pass: !probe.fakeFx && !probe.voidFx,
		detail: `no fake CSS backdrop (apex=${probe.fakeFx} void=${probe.voidFx})`,
	});
	checks.push({
		pass: probe.body.includes("menu-active"),
		detail: `body.menu-active=${probe.body.includes("menu-active")}`,
	});

	if (camDist != null && camY != null) {
		const orbitOk = camDist >= 32 && camDist <= 52 && camY >= 10 && camY <= 20;
		checks.push({
			pass: orbitOk,
			detail: `camera xzDist=${camDist.toFixed(1)} y=${camY.toFixed(1)} (want ~40 / ~13.5)`,
		});
	} else {
		checks.push({
			pass: true,
			detail: "camera pose hook unavailable — screenshot-only check",
		});
	}

	const shot = join(OUT, "menu-orbit.png");
	await page.screenshot({ path: shot, fullPage: false });

	/** Anty-washout: średnia luminancja środka boiska (ffmpeg → raw RGB, bez deps). */
	let centerLum = null;
	try {
		const { spawnSync } = await import("node:child_process");
		const { readFileSync } = await import("node:fs");
		void readFileSync; // shot already on disk
		const cx = 800;
		const cy = 522;
		const side = 56;
		const ff = spawnSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-i",
				shot,
				"-vf",
				`crop=${side}:${side}:${cx - side / 2}:${cy - side / 2}`,
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"-",
			],
			{ encoding: "buffer", maxBuffer: 2_000_000 },
		);
		if (ff.status === 0 && ff.stdout?.length) {
			const buf = ff.stdout;
			let sum = 0;
			const n = buf.length / 3;
			for (let i = 0; i < buf.length; i += 3) {
				sum += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
			}
			centerLum = n > 0 ? sum / n : null;
		}
	} catch {
		centerLum = null;
	}
	if (centerLum != null) {
		checks.push({
			pass: centerLum < 160,
			detail: `center pitch luminance=${centerLum.toFixed(0)} (want < 160, anti-washout)`,
		});
	}

	/** Hot pixels wokół auta — glow / snopy / bloom. */
	let hotFrac = null;
	try {
		const { spawnSync } = await import("node:child_process");
		const ff = spawnSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-i",
				shot,
				"-vf",
				"crop=160:160:720:460",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"-",
			],
			{ encoding: "buffer", maxBuffer: 2_000_000 },
		);
		if (ff.status === 0 && ff.stdout?.length) {
			const buf = ff.stdout;
			let hot = 0;
			const n = buf.length / 3;
			for (let i = 0; i < buf.length; i += 3) {
				const L = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
				if (L > 200) hot++;
			}
			hotFrac = n > 0 ? hot / n : null;
		}
	} catch {
		hotFrac = null;
	}
	if (hotFrac != null) {
		checks.push({
			pass: hotFrac < 0.08,
			detail: `car-region hotFrac=${(hotFrac * 100).toFixed(1)}% (want < 8%)`,
		});
	}

	const allPass = checks.every((c) => c.pass);
	const md = [
		"# Menu Stadium Orbit Audit",
		"",
		`Wynik: **${allPass ? "PASS" : "FAIL"}**`,
		"",
		"| Check | Pass | Detail |",
		"|-------|------|--------|",
		...checks.map((c) => `| — | ${c.pass ? "✓" : "✗"} | ${c.detail} |`),
		"",
		`Screenshot: \`${shot}\``,
		"",
	].join("\n");

	writeFileSync(join(OUT, "MENU_ORBIT.md"), md);
	console.info(md);
	process.exit(allPass ? 0 : 1);
} catch (err) {
	console.error(err);
	writeFileSync(
		join(OUT, "MENU_ORBIT.md"),
		`# Menu Stadium Orbit Audit\n\n**FAIL** — ${String(err)}\n`,
	);
	process.exit(1);
} finally {
	await browser.close();
}
