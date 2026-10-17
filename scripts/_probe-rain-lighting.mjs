/**
 * Verify rain ovals + pitch light play (dry / wet).
 *   CHROMIUM_PATH=... node scripts/_probe-rain-lighting.mjs
 * Requires Vite on IGNITE_VITE_URL (default http://127.0.0.1:5173).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const OUT = join(process.cwd(), "test-results", "rain-lighting");
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
	if (/error|Error|TypeError|WebGL|failed|FAIL/i.test(t)) logs.push(t.slice(0, 240));
});
page.on("pageerror", (e) => logs.push(`PAGEERR ${String(e).slice(0, 400)}`));

await page.addInitScript(() => {
	try {
		localStorage.setItem("ignite.seenBootCinematic.v1", "1");
		localStorage.setItem("ignite.graphicsQuality", "high");
	} catch {
		/* */
	}
});

const url = `${BASE}/?autostart=1v1&skipIntro=1&graphics=high&t=${Date.now()}`;
console.log("goto", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

try {
	await page.waitForFunction(
		() => (window.__igniteSession?.cars?.length ?? 0) >= 2,
		null,
		{ timeout: 180_000 },
	);
} catch (err) {
	console.error("NO SESSION", err.message);
	console.error("logs", logs.slice(-20));
	await page.screenshot({ path: join(OUT, "fail-boot.png") }).catch(() => {});
	await browser.close();
	process.exit(1);
}

await page.waitForTimeout(2500);

/** Freeze physics + lock cam for stills. */
await page.evaluate(() => {
	window.__igniteCaptureFreezePhysics = true;
	window.__igniteCaptureCamLock = true;
	const cam = window.__igniteRenderer?.threeJSCamera;
	if (cam) {
		cam.position.set(0, 28, 78);
		cam.lookAt(0, 2, 0);
		cam.updateMatrixWorld(true);
	}
});

await page.waitForTimeout(400);

const dryProbe = await page.evaluate(() => {
	const scene = window.__igniteScene;
	const weather = scene?.weather;
	weather?.setRaining?.(false);
	if (weather) weather.intensity = 0;
	const mat = scene?.threeJSScene
		? (() => {
				let pitch = null;
				scene.threeJSScene.traverse((o) => {
					if (o.name === "pitchFloor" || o.material?.name === "pitchFloorGrassDetail") {
						pitch = o.material;
					}
				});
				return pitch;
			})()
		: null;
	const lights = scene?.lighting?.pitchLights ?? [];
	return {
		raining: weather?.isRaining ?? null,
		jupiter: lights.map((l) => l.intensity),
		pitchRoughness: mat?.roughness ?? null,
		pitchEnv: mat?.envMapIntensity ?? null,
		pitchCoat: mat?.clearcoat ?? null,
		shader: weather?.rainParticles?.material?.isShaderMaterial ?? null,
		lightCount:
			weather?.rainParticles?.material?.uniforms?.uLightCount?.value ?? null,
	};
});
console.log("dry", dryProbe);

await page.evaluate(() => {
	const r = window.__igniteRenderer;
	const s = window.__igniteScene;
	if (r && s) {
		s.weather?.setFloodLights?.(s.lighting.pitchLights);
		r.render(s, 0.016);
	}
});
await page.waitForTimeout(200);
await page.screenshot({ path: join(OUT, "pitch-dry.png"), type: "png" });

const rainProbe = await page.evaluate(() => {
	const scene = window.__igniteScene;
	const weather = scene?.weather;
	weather?.setRaining?.(true);
	if (weather) weather.intensity = 1;
	weather?.setFloodLights?.(scene.lighting.pitchLights);
	const mat = weather?.rainParticles?.material;
	return {
		raining: weather?.isRaining,
		visible: weather?.rainParticles?.visible,
		shader: mat?.isShaderMaterial ?? false,
		hasGlint: Boolean(mat?.fragmentShader?.includes?.("uLightPos")),
		lightCount: mat?.uniforms?.uLightCount?.value ?? 0,
		glint: mat?.uniforms?.uGlintStrength?.value ?? null,
		opacity: mat?.uniforms?.uOpacity?.value ?? null,
	};
});
console.log("rain", rainProbe);

for (let i = 0; i < 12; i++) {
	await page.evaluate(() => {
		const r = window.__igniteRenderer;
		const s = window.__igniteScene;
		if (r && s) {
			s.weather?.setFloodLights?.(s.lighting.pitchLights);
			s.weather?.update?.(0.016, r.threeJSCamera);
			r.render(s, 0.016);
		}
	});
}
await page.screenshot({ path: join(OUT, "rain-on.png"), type: "png" });

await browser.close();

const ok =
	dryProbe.shader === true &&
	(dryProbe.jupiter?.[0] ?? 0) >= 0.25 &&
	rainProbe.shader === true &&
	rainProbe.hasGlint === true &&
	(rainProbe.lightCount ?? 0) >= 2;

console.log(ok ? `OK → ${OUT}` : `CHECK → ${OUT}`);
if (logs.length) console.log("logs", logs.slice(-10));
process.exit(ok ? 0 : 2);
