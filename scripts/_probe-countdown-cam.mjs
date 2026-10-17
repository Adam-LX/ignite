/**
 * Live probe: countdown camera + car NDC during 5→1.
 * node scripts/_probe-countdown-cam.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROMIUM =
	process.env.CHROMIUM_PATH || "/run/current-system/sw/bin/chromium";
const VITE = "http://127.0.0.1:5173";
const OUT = join(process.cwd(), "test-results", "countdown-cam");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
	executablePath: CHROMIUM,
	headless: true,
	args: [
		"--use-gl=angle",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
		"--no-sandbox",
		"--disable-dev-shm-usage",
	],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => {
	const t = m.text();
	if (/error|Error|CAM|countdown|blend/i.test(t)) console.log("CON:", t.slice(0, 200));
});

await page.goto(`${VITE}/?autostart=1v1&t=${Date.now()}`, {
	waitUntil: "domcontentloaded",
	timeout: 120000,
});
await page.waitForFunction(() => window.__igniteSession, { timeout: 120000 });
console.log("session ok");

/** Hold countdown so we can sample, then release and sample through ticks. */
const samples = await page.evaluate(async () => {
	const s = window.__igniteSession;
	const r = window.__igniteMatchDeps?.renderer ?? null;
	const out = [];

	const sample = (label) => {
		const cam = r?.threeJSCamera;
		const car = s.humanCar?.player?.getPosition?.() ?? s.humanCar?.getPosition?.();
		const ball = window.__igniteBall?.getPosition?.() ?? { x: 0, y: 1, z: 0 };
		if (!cam || !car) return;
		const ndc = car.clone ? car.clone().project(cam) : null;
		const carV = car.clone ? car : null;
		const blend = s.match?.getKickoffCameraMatchBlend?.() ?? null;
		const phase = s.match?.getPhase?.() ?? null;
		const tick = s.match?.getHudSnapshot?.([])?.kickoffTick ?? null;
		const look = r?.chaseState?.smoothedLookAt;
		out.push({
			label,
			phase,
			tick,
			blend,
			ndc: ndc
				? { x: +ndc.x.toFixed(3), y: +ndc.y.toFixed(3), z: +ndc.z.toFixed(3) }
				: null,
			cam: {
				x: +cam.position.x.toFixed(2),
				y: +cam.position.y.toFixed(2),
				z: +cam.position.z.toFixed(2),
			},
			car: carV
				? {
						x: +carV.x.toFixed(2),
						y: +carV.y.toFixed(2),
						z: +carV.z.toFixed(2),
					}
				: null,
			look: look
				? {
						x: +look.x.toFixed(2),
						y: +look.y.toFixed(2),
						z: +look.z.toFixed(2),
					}
				: null,
			preferY: null,
		});
	};

	s.match?.setCountdownHold?.(true);
	await new Promise((r) => setTimeout(r, 400));
	sample("hold-kickoff");

	s.match?.setCountdownHold?.(false);
	for (let i = 0; i < 28; i++) {
		await new Promise((r) => setTimeout(r, 200));
		sample(`t=${(i * 0.2).toFixed(1)}`);
		const phase = s.match?.getPhase?.();
		if (phase === "playing" && i > 8) break;
	}
	sample("end");
	return out;
});

writeFileSync(join(OUT, "samples.json"), JSON.stringify(samples, null, 2));
await page.screenshot({ path: join(OUT, "countdown.png") });
console.log("samples", samples.length);
for (const s of samples.filter((_, i) => i % 3 === 0 || s.label === "hold-kickoff" || s.label === "end")) {
	console.log(
		s.label,
		"phase=",
		s.phase,
		"tick=",
		s.tick,
		"blend=",
		s.blend?.toFixed?.(3) ?? s.blend,
		"ndc.y=",
		s.ndc?.y,
		"cam.y=",
		s.cam?.y,
		"look.y=",
		s.look?.y,
	);
}
await browser.close();
console.log("wrote", OUT);
