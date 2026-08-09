import { chromium } from "playwright";

const CHROMIUM = "/run/current-system/sw/bin/chromium";
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

await page.goto("http://127.0.0.1:5173/?showcaseAudit=1", {
	waitUntil: "domcontentloaded",
	timeout: 120000,
});
await page.waitForFunction(() => window.__igniteRenderer, { timeout: 180000 });
await page.waitForSelector("#main-menu-start", { timeout: 120000 });
await page.waitForTimeout(500);

const menuCam = await page.evaluate(() => {
	const r = window.__igniteRenderer;
	const c = r.threeJSCamera;
	return {
		cam: { x:+c.position.x.toFixed(2), y:+c.position.y.toFixed(2), z:+c.position.z.toFixed(2) },
		menuPres: r.menuPresentationActive,
	};
});
console.log("MENU", JSON.stringify(menuCam));

await page.click('.mode-card[data-mode="1v1"]');
await page.click("#main-menu-start");

await page.waitForFunction(() => window.__igniteSession, { timeout: 120000 });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
	const s = window.__igniteSession;
	const r = window.__igniteRenderer;
	const cam = r.threeJSCamera;
	const car = s.humanCar.player.getPosition();
	const dist = cam.position.distanceTo(car);
	cam.updateMatrixWorld(true);
	cam.updateProjectionMatrix();
	const e = cam.matrixWorldInverse.elements;
	const p = cam.projectionMatrix.elements;
	const x = car.x, y = car.y, z = car.z;
	const wx = e[0]*x + e[4]*y + e[8]*z + e[12];
	const wy = e[1]*x + e[5]*y + e[9]*z + e[13];
	const wz = e[2]*x + e[6]*y + e[10]*z + e[14];
	const ww = e[3]*x + e[7]*y + e[11]*z + e[15];
	const cx = p[0]*wx + p[4]*wy + p[8]*wz + p[12]*ww;
	const cy = p[1]*wx + p[5]*wy + p[9]*wz + p[13]*ww;
	const cw = p[3]*wx + p[7]*wy + p[11]*wz + p[15]*ww;
	const tags = [...document.querySelectorAll(".car-name-tag")].map((el) => {
		const rect = el.getBoundingClientRect();
		return {
			text: el.textContent?.trim(),
			nx: +((rect.x + rect.width / 2) / innerWidth).toFixed(3),
			ny: +((rect.y + rect.height / 2) / innerHeight).toFixed(3),
		};
	});
	return {
		cam: { x:+cam.position.x.toFixed(2), y:+cam.position.y.toFixed(2), z:+cam.position.z.toFixed(2), fov:+cam.fov.toFixed(2) },
		car: { x:+car.x.toFixed(2), y:+car.y.toFixed(2), z:+car.z.toFixed(2) },
		dist: +dist.toFixed(2),
		ndc: { x: +(cx/cw).toFixed(3), y: +(cy/cw).toFixed(3) },
		menuPres: r.menuPresentationActive,
		garagePres: r.garagePresentationActive,
		phase: s.match.getPhase(),
		body: document.body.className,
		tags,
	};
});
console.log("MATCH", JSON.stringify(info, null, 2));
await page.screenshot({ path: "/tmp/ignite-cam-menu-path.png" });
await browser.close();
