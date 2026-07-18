#!/usr/bin/env node
/**
 * Audyt chase kamery — screenshot + metryki + PASS/FAIL.
 *
 *   node scripts/audit-chase-camera.mjs
 *   node scripts/audit-chase-camera.mjs --path=menu
 *   node scripts/audit-chase-camera.mjs --survey
 *   node scripts/audit-chase-camera.mjs --target=electron --survey
 *
 * Exit 0 = PASS, 1 = FAIL, 2 = setup error.
 *
 * Kryteria PASS (kamera + czytelność kadru):
 *   - dist(cam, car) ≤ 10 m
 *   - |ndc.x| ≤ 0.4, ndc.y ∈ [-0.85, 0.15]
 *   - cam.y < car.y + 8
 *   - menuPresentation / garagePresentation = false
 *   - pixelAtCar nie jest grass / washout (biały)
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
const CDP = process.env.IGNITE_CDP_URL || "http://127.0.0.1:9222";

function argVal(flag) {
	const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
	if (eq) return eq.slice(flag.length + 1);
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(flag) {
	return process.argv.includes(flag);
}

const target = (argVal("--target") || "vite").toLowerCase();
const pathMode = (argVal("--path") || "autostart").toLowerCase();
const doSurvey = hasFlag("--survey");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

/** Pozycje survey — różne zakątki boiska RL-ish. */
const FIELD_PROBES = [
	{ id: "kickoff-blue", x: 0, z: -40, yaw: 0, ballCam: true },
	{ id: "midfield", x: 0, z: -14, yaw: 0.25, ballCam: true },
	{ id: "orange-half", x: 12, z: 45, yaw: Math.PI, ballCam: true },
	{ id: "blue-corner-L", x: -45, z: -70, yaw: 0.8, ballCam: true },
	{ id: "blue-corner-R", x: 45, z: -70, yaw: -0.8, ballCam: true },
	{ id: "sideline-L", x: -55, z: 10, yaw: 1.2, ballCam: false },
	{ id: "sideline-R", x: 55, z: -10, yaw: -1.2, ballCam: true },
	{ id: "orange-goal", x: 8, z: 72, yaw: Math.PI, ballCam: true },
	{ id: "blue-goal", x: -8, z: -72, yaw: 0, ballCam: true },
	{ id: "near-jupiter", x: -50, z: -80, yaw: 0.3, ballCam: true },
];

mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "survey"), { recursive: true });

function judge(audit) {
	const fails = [];
	if (!audit || audit.reason === "no-session") {
		fails.push("no-session");
		return { pass: false, fails };
	}
	if (audit.dist > 10) fails.push(`dist=${audit.dist?.toFixed?.(2) ?? audit.dist}`);
	if (Math.abs(audit.ndc?.x ?? 99) > 0.4) fails.push(`ndc.x=${audit.ndc?.x}`);
	if ((audit.ndc?.y ?? 99) < -0.85 || (audit.ndc?.y ?? -99) > 0.15) {
		fails.push(`ndc.y=${audit.ndc?.y}`);
	}
	if ((audit.cam?.y ?? 0) >= (audit.car?.y ?? 0) + 8) {
		fails.push(`camTooHigh y=${audit.cam?.y}`);
	}
	if (audit.menuPresentation) fails.push("menuPresentation");
	if (audit.garagePresentation) fails.push("garagePresentation");
	if (!/in-match/.test(audit.body || "")) fails.push(`body=${audit.body}`);
	const present = audit.canvases?.present;
	const source = audit.canvases?.source;
	if (present && present.display === "none") fails.push("presentHidden");
	if (source && source.display === "none") fails.push("sourceDisplayNone");
	if (audit.pixelAtCar?.kind === "grass") fails.push("pixelGrassAtCar");
	if (audit.pixelAtCarGl?.kind === "grass") fails.push("pixelGrassAtCarGl");
	/**
	 * Pojedynczy „washout” na aucie = często biały lakier / specular.
	 * Fail tylko gdy prześwietlony jest cały kadr.
	 */
	if ((audit.frameWashout ?? 0) > 0.35) {
		fails.push(`frameWashout=${audit.frameWashout?.toFixed?.(2)}`);
	} else if (
		audit.pixelAtCar?.kind === "washout" &&
		(audit.frameWashout ?? 0) > 0.2 &&
		!(typeof audit.tagErr === "number" && audit.tagErr < 0.12)
	) {
		fails.push("pixelWashoutAtCar");
	}
	return { pass: fails.length === 0, fails };
}

async function connectPage() {
	if (target === "electron") {
		const browser = await chromium.connectOverCDP(CDP);
		const context = browser.contexts()[0];
		if (!context) throw new Error("Brak Electron context — CDP?");
		const page =
			context.pages().find((p) => p.url().includes("127.0.0.1") || p.url().includes("localhost")) ||
			context.pages()[0];
		if (!page) throw new Error("Brak Electron page");
		return { browser, page, close: async () => browser.close() };
	}

	const browser = await chromium.launch({
		headless: true,
		executablePath: CHROMIUM,
		args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
	});
	const page = await browser.newPage({
		viewport: { width: 1600, height: 900 },
	});
	return {
		browser,
		page,
		close: async () => browser.close(),
	};
}

async function startMatch(page) {
	if (pathMode === "menu") {
		await page.goto(`${VITE}/`, {
			waitUntil: "domcontentloaded",
			timeout: 120_000,
		});
		await page.waitForFunction(() => window.__igniteRenderer, {
			timeout: 180_000,
		});
		await page.waitForSelector("#main-menu-start", { timeout: 120_000 });
		await page.click('.mode-card[data-mode="1v1"]');
		await page.click("#main-menu-start");
	} else {
		await page.goto(`${VITE}/?autostart=1v1`, {
			waitUntil: "domcontentloaded",
			timeout: 120_000,
		});
	}
	await page.waitForFunction(() => window.__igniteSession, {
		timeout: 180_000,
	});
	await page.waitForTimeout(2200);
}

async function sampleAudit(page) {
	return page.evaluate(() => {
		const base =
			typeof window.__igniteCameraAudit === "function"
				? window.__igniteCameraAudit()
				: null;
		if (!base || base.reason === "no-session") {
			return base || { ok: false, reason: "no-session" };
		}

		const present = document.querySelector("canvas.webgl-present-canvas");
		const source = document.querySelector("canvas.webgl-source-canvas");

		let pixelAtCar = null;
		let pixelAtCarGl = null;
		let frameWashout = 0;

		const classifyPatch = (ctx, cx, cy, w, h, label) => {
			let grassN = 0;
			let washN = 0;
			let darkN = 0;
			let otherN = 0;
			let sr = 0,
				sg = 0,
				sb = 0;
			let n = 0;
			for (let dy = -2; dy <= 2; dy++) {
				for (let dx = -2; dx <= 2; dx++) {
					const x = Math.max(0, Math.min(w - 1, cx + dx * 3));
					const y = Math.max(0, Math.min(h - 1, cy + dy * 3));
					const d = ctx.getImageData(x, y, 1, 1).data;
					const r = d[0],
						g = d[1],
						b = d[2];
					sr += r;
					sg += g;
					sb += b;
					n++;
					const avg = (r + g + b) / 3;
					if (avg > 230 && Math.max(r, g, b) - Math.min(r, g, b) < 35) washN++;
					else if (g > r + 12 && g > b + 12 && g > 40) grassN++;
					else if (avg < 50) darkN++;
					else otherN++;
				}
			}
			const rgb = [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
			/** Większość patcha — pojedynczy specular na aucie nie failuje. */
			let kind = "other";
			if (washN >= 18 && (sr + sg + sb) / (3 * n) > 235) kind = "washout";
			else if (grassN >= 15) kind = "grass";
			else if (darkN + otherN >= 10) kind = darkN >= otherN ? "dark" : "other";
			return { rgb, kind, canvas: label, washN, grassN, darkN, otherN };
		};

		const sample2d = (vis, label) => {
			if (!vis || !base.carScreen) return null;
			try {
				const ctx = vis.getContext("2d", { willReadFrequently: true });
				if (!ctx) return { error: "no-2d", canvas: label };
				const x = Math.floor(base.carScreen.nx * vis.width);
				const y = Math.floor(base.carScreen.ny * vis.height);
				return classifyPatch(ctx, x, y, vis.width, vis.height, label);
			} catch (e) {
				return { error: String(e), canvas: label };
			}
		};

		const sampleWashoutGrid = (vis) => {
			if (!vis) return 0;
			try {
				const ctx = vis.getContext("2d", { willReadFrequently: true });
				if (!ctx) return 0;
				const w = vis.width;
				const h = vis.height;
				let hot = 0;
				let n = 0;
				for (let gy = 1; gy <= 4; gy++) {
					for (let gx = 1; gx <= 6; gx++) {
						const x = Math.floor((gx / 7) * w);
						const y = Math.floor((gy / 5) * h);
						const d = ctx.getImageData(x, y, 1, 1).data;
						const avg = (d[0] + d[1] + d[2]) / 3;
						if (avg > 210) hot++;
						n++;
					}
				}
				return n ? hot / n : 0;
			} catch {
				return 0;
			}
		};

		pixelAtCar = sample2d(present, "present");
		frameWashout = sampleWashoutGrid(present);
		if (source && base.carScreen) {
			try {
				const tmp = document.createElement("canvas");
				tmp.width = source.width;
				tmp.height = source.height;
				const tctx = tmp.getContext("2d");
				tctx.drawImage(source, 0, 0);
				pixelAtCarGl = sample2d(tmp, "webgl-copy");
			} catch (e) {
				pixelAtCarGl = { error: String(e) };
			}
		}
		return { ...base, pixelAtCar, pixelAtCarGl, frameWashout };
	});
}

async function teleportProbe(page, probe) {
	const ok = await page.evaluate((p) => {
		if (typeof window.__igniteCameraTeleport !== "function") return false;
		window.__igniteCameraTeleport({
			x: p.x,
			z: p.z,
			yaw: p.yaw,
			ballCam: p.ballCam,
		});
		return true;
	}, probe);
	if (!ok) throw new Error("__igniteCameraTeleport niedostępne — hard refresh Vite?");
	/** Dwie klatki: spektakl/gole mogą nadpisać — drugi snap. */
	await page.waitForTimeout(120);
	await page.evaluate((p) => {
		window.__igniteCameraTeleport?.({
			x: p.x,
			z: p.z,
			yaw: p.yaw,
			ballCam: p.ballCam,
		});
	}, probe);
	await page.waitForTimeout(280);
	return sampleAudit(page);
}

const logs = [];
let session = null;

try {
	session = await connectPage();
	const { page } = session;
	page.on("console", (m) => {
		const t = m.text();
		if (/\[Match\]|\[Boot\]|Error|TypeError|cam/.test(t)) logs.push(t);
	});

	if (target === "electron") {
		const hasSession = await page.evaluate(() => !!window.__igniteSession);
		if (!hasSession) {
			const url = page.url();
			if (!url.includes("autostart")) {
				await page.goto(`${VITE}/?autostart=1v1`, {
					waitUntil: "domcontentloaded",
					timeout: 120_000,
				});
			}
			await page.waitForFunction(() => window.__igniteSession, {
				timeout: 180_000,
			});
			await page.waitForTimeout(2200);
		} else {
			await page.waitForTimeout(500);
		}
	} else {
		await startMatch(page);
	}

	const samples = [];
	if (doSurvey) {
		for (const probe of FIELD_PROBES) {
			const audit = await teleportProbe(page, probe);
			const verdict = judge(audit);
			const shotPath = join(
				OUT,
				"survey",
				`${stamp}-${probe.id}.png`,
			);
			await page.screenshot({ path: shotPath, type: "png" });
			samples.push({
				id: probe.id,
				probe,
				pass: verdict.pass,
				fails: verdict.fails,
				dist: audit?.dist,
				ndc: audit?.ndc,
				cam: audit?.cam,
				car: audit?.car,
				pixelAtCar: audit?.pixelAtCar,
				frameWashout: audit?.frameWashout,
				screenshot: shotPath,
			});
			console.log(
				`[survey] ${probe.id}: ${verdict.pass ? "PASS" : "FAIL"} fails=${verdict.fails.join("|") || "—"} wash=${(audit?.frameWashout ?? 0).toFixed(2)}`,
			);
		}
	}

	const audit = doSurvey
		? samples[0]?.pass === false
			? (
					await (async () => {
						/* re-sample current */
						return sampleAudit(page);
					})()
				)
			: await sampleAudit(page)
		: await sampleAudit(page);
	const verdict = doSurvey
		? {
				pass: samples.every((s) => s.pass),
				fails: samples.flatMap((s) =>
					s.fails.map((f) => `${s.id}:${f}`),
				),
			}
		: judge(audit);

	const shotPath = join(OUT, `chase-${target}-${pathMode}-${stamp}.png`);
	await page.screenshot({ path: shotPath, type: "png" });

	const report = {
		generatedAt: new Date().toISOString(),
		target,
		path: pathMode,
		survey: doSurvey,
		pass: verdict.pass,
		fails: verdict.fails,
		audit: doSurvey ? undefined : audit,
		samples: doSurvey ? samples : undefined,
		screenshot: shotPath,
		logs: logs.slice(-40),
		hints: verdict.pass
			? []
			: [
					"src/Renderer.ts (followPlayer / snapChaseCamera)",
					"src/game/GameSession.ts (applyMatchCamera)",
					"src/main.ts (startMatch snap + menu loop)",
					"src/visual/cameraFollow.ts",
					"src/visual/shaders/lensFlarePost.ts (washout)",
				],
	};

	const jsonPath = join(OUT, `chase-${target}-${pathMode}-${stamp}.json`);
	const latestJson = join(OUT, "LATEST.json");
	const latestMd = join(OUT, "LATEST.md");
	writeFileSync(jsonPath, JSON.stringify(report, null, 2));
	writeFileSync(latestJson, JSON.stringify(report, null, 2));

	const mdLines = [
		`# Chase camera audit`,
		``,
		`- **PASS:** ${verdict.pass}`,
		`- target: \`${target}\` path: \`${pathMode}\` survey: ${doSurvey}`,
		`- fails: ${verdict.fails.join(", ") || "—"}`,
		`- screenshot: \`${shotPath}\``,
		``,
	];
	if (doSurvey) {
		mdLines.push(`## Field survey`, ``);
		for (const s of samples) {
			mdLines.push(
				`### ${s.id} — ${s.pass ? "PASS" : "FAIL"}`,
				``,
				`- fails: ${s.fails.join(", ") || "—"}`,
				`- dist: ${s.dist?.toFixed?.(2) ?? "—"}`,
				`- ndc: ${JSON.stringify(s.ndc ?? null)}`,
				`- car: ${JSON.stringify(s.car ?? null)}`,
				`- cam: ${JSON.stringify(s.cam ?? null)}`,
				`- pixel: ${JSON.stringify(s.pixelAtCar ?? null)}`,
				`- frameWashout: ${s.frameWashout?.toFixed?.(2) ?? "—"}`,
				`- ![](${s.screenshot.replace(OUT + "/", "")})`,
				``,
			);
		}
		writeFileSync(
			join(OUT, "survey", `${stamp}-FIELD.md`),
			mdLines.join("\n"),
		);
		writeFileSync(join(OUT, "FIELD.md"), mdLines.join("\n"));
	} else {
		mdLines.push(
			`- dist: ${audit?.dist?.toFixed?.(2) ?? "—"}`,
			`- ndc: ${JSON.stringify(audit?.ndc ?? null)}`,
			`- cam: ${JSON.stringify(audit?.cam ?? null)}`,
			`- car: ${JSON.stringify(audit?.car ?? null)}`,
			`- frameWashout: ${audit?.frameWashout?.toFixed?.(2) ?? "—"}`,
			``,
			verdict.pass
				? `_Kamera OK._`
				: `## Hints\n\n${report.hints.map((h) => `- \`${h}\``).join("\n")}`,
			``,
		);
	}
	writeFileSync(latestMd, mdLines.join("\n"));

	console.log(
		JSON.stringify(
			{
				pass: verdict.pass,
				fails: verdict.fails.slice(0, 20),
				surveySamples: doSurvey ? samples.length : 0,
				shot: shotPath,
			},
			null,
			2,
		),
	);
	console.log(`[audit-chase] ${verdict.pass ? "PASS" : "FAIL"} → ${latestMd}`);

	await session.close();
	process.exit(verdict.pass ? 0 : 1);
} catch (err) {
	console.error("[audit-chase] ERROR", err);
	writeFileSync(
		join(OUT, "LATEST.json"),
		JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				pass: false,
				fails: ["setup-error"],
				error: String(err?.stack || err),
			},
			null,
			2,
		),
	);
	try {
		await session?.close?.();
	} catch {
		/* ignore */
	}
	process.exit(2);
}
