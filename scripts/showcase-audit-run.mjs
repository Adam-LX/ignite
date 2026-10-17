#!/usr/bin/env node
/** Headless audyt showcase — ?showcaseAudit=1, logi konsoli, snapshot sceny. */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.IGNITE_VITE_URL?.replace(/\/?$/, "") ?? "http://127.0.0.1:5173";
const OUT = join(process.cwd(), "screenshots");
mkdirSync(OUT, { recursive: true });

const modes = [
	{ label: "default", qs: "?showcaseAudit=1" },
	{ label: "canvasOnly", qs: "?showcaseAudit=1&canvasOnly=1" },
];

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const report = { stamp, base: BASE, modes: [] };

for (const mode of modes) {
	const url = `${BASE}/${mode.qs}`;
	const logs = [];
	const browser = await chromium.launch({
		headless: true,
		args: ["--use-gl=angle", "--use-angle=swiftshader"],
	});
	const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
	page.on("console", (msg) => {
		const t = msg.text();
		if (
			t.includes("[Ignite") ||
			t.includes("showcase audit") ||
			t.includes("FlyBall")
		) {
			logs.push(`[${msg.type()}] ${t}`);
		}
	});

	console.log(`\n=== ${mode.label} → ${url}`);
	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

	// Boot menu 3D (Rapier + modele + liveMenu.init)
	await page.waitForFunction(
		() => document.getElementById("loading")?.classList.contains("hidden"),
		{ timeout: 180_000 },
	);
	await page.waitForTimeout(3500);

	const sceneProbe = await page.evaluate(() => {
		const canvas = document.querySelector("#game-container canvas");
		const bodyMeshes = [];
		let menuHero = 0;
		let menuSpin = 0;
		const win = window;
		const renderer = win.__igniteRenderer;
		const scene = win.__igniteScene;
		if (scene?.threeJSScene) {
			scene.threeJSScene.traverse((n) => {
				if (n.name === "menuHeroCar") menuHero++;
				if (n.name === "menuHeroSpin") menuSpin++;
				if (n.name === "body" && n.visible) bodyMeshes.push(n.uuid.slice(0, 8));
			});
		}
		const hero = scene?.threeJSScene?.getObjectByName("menuHeroCar");
		const spin = hero?.getObjectByName("menuHeroSpin");
		const ySamples = [];
		if (hero && spin) {
			for (let i = 0; i < 8; i++) {
				spin.rotation.y = (Math.PI / 4) * i;
				hero.updateMatrixWorld(true);
				ySamples.push(Number(hero.position.y.toFixed(5)));
			}
		}
		const ySpread = ySamples.length
			? Math.max(...ySamples) - Math.min(...ySamples)
			: 0;
		return {
			canvasOnly: document.body.classList.contains("showcase-canvas-only"),
			menuActive: document.body.classList.contains("menu-active"),
			canvasCount: document.querySelectorAll("#game-container canvas").length,
			canvasSize: canvas
				? { w: canvas.width, h: canvas.height, clientW: canvas.clientWidth }
				: null,
			directRender: renderer?.menuPresentationActive ?? null,
			pixelRatio: renderer?.threeJSRenderer?.getPixelRatio?.() ?? null,
			menuHero,
			menuSpin,
			bodyMeshCount: bodyMeshes.length,
			heroYSpreadDuringSpin: ySpread,
			heroYSamples: ySamples,
		};
	});

	const shotPath = join(OUT, `showcase-audit-${mode.label}-${stamp}.png`);
	await page.screenshot({ path: shotPath, fullPage: false });

	report.modes.push({ ...mode, url, logs, sceneProbe, screenshot: shotPath });
	await browser.close();

	console.log("sceneProbe:", JSON.stringify(sceneProbe, null, 2));
	for (const line of logs) console.log(line);
}

const jsonPath = join(OUT, `showcase-audit-${stamp}.json`);
writeFileSync(jsonPath, JSON.stringify(report, null, 2));
console.log(`\nReport: ${jsonPath}`);
