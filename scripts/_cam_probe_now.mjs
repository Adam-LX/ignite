import { chromium } from "playwright";

const CHROMIUM =
	process.env.CHROMIUM_PATH ??
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	"/run/current-system/sw/bin/chromium";

const browser = await chromium.launch({
	headless: true,
	executablePath: CHROMIUM,
	args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => {
	const t = m.text();
	if (/\[Match\]|\[Boot\]|Error|TypeError/.test(t)) console.log("CON:", t);
});

// Inject renderer expose before game loads - via init script after navigation is hard.
// Instead use autostart and then evaluate through monkeypatching main if we add __igniteRenderer always in DEV.

await page.addInitScript(() => {
	window.__camProbe = { frames: [] };
});

await page.goto("http://127.0.0.1:5173/?autostart=1v1&showcaseAudit=1", {
	waitUntil: "domcontentloaded",
	timeout: 120000,
});
await page.waitForFunction(() => window.__igniteSession && window.__igniteRenderer, {
	timeout: 180000,
});
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
	const s = window.__igniteSession;
	const r = window.__igniteRenderer;
	const cam = r.threeJSCamera;
	const car = s.humanCar.player.getPosition();
	const ball = s /* ball via */;
	const dist = cam.position.distanceTo(car);
	const v = car.clone ? car.clone() : null;
	// project car
	const THREE = cam.isPerspectiveCamera ? null : null;
	const ndc = { x: 0, y: 0 };
	// manual project using camera matrices
	cam.updateMatrixWorld(true);
	cam.updateProjectionMatrix();
	const e = cam.matrixWorldInverse.elements;
	const p = cam.projectionMatrix.elements;
	// world to clip
	const x = car.x, y = car.y, z = car.z;
	const wx = e[0]*x + e[4]*y + e[8]*z + e[12];
	const wy = e[1]*x + e[5]*y + e[9]*z + e[13];
	const wz = e[2]*x + e[6]*y + e[10]*z + e[14];
	const ww = e[3]*x + e[7]*y + e[11]*z + e[15];
	const cx = p[0]*wx + p[4]*wy + p[8]*wz + p[12]*ww;
	const cy = p[1]*wx + p[5]*wy + p[9]*wz + p[13]*ww;
	const cw = p[3]*wx + p[7]*wy + p[11]*wz + p[15]*ww;
	ndc.x = cx / cw;
	ndc.y = cy / cw;

	const tags = [...document.querySelectorAll(".car-name-tag")].map((el) => {
		const rect = el.getBoundingClientRect();
		return {
			text: el.textContent?.trim(),
			nx: (rect.x + rect.width / 2) / innerWidth,
			ny: (rect.y + rect.height / 2) / innerHeight,
		};
	});

	return {
		cam: {
			x: +cam.position.x.toFixed(2),
			y: +cam.position.y.toFixed(2),
			z: +cam.position.z.toFixed(2),
			fov: +cam.fov.toFixed(2),
		},
		car: { x: +car.x.toFixed(2), y: +car.y.toFixed(2), z: +car.z.toFixed(2) },
		dist: +dist.toFixed(2),
		ndc: { x: +ndc.x.toFixed(3), y: +ndc.y.toFixed(3) },
		menuPres: r.menuPresentationActive ?? "?",
		garagePres: r.garagePresentationActive ?? "?",
		ballCam: r.isBallCamEnabled?.(),
		phase: s.match.getPhase(),
		body: document.body.className,
		tags,
		canvas: {
			cls: document.querySelector("canvas")?.className,
			display: getComputedStyle(document.querySelector("canvas.webgl-source-canvas") || document.querySelector("canvas")).display,
			w: document.querySelector("canvas.webgl-source-canvas")?.width,
			h: document.querySelector("canvas.webgl-source-canvas")?.height,
		},
	};
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "/tmp/ignite-cam-probe-now.png" });
await browser.close();
console.log("saved /tmp/ignite-cam-probe-now.png");
