#!/usr/bin/env node
/**
 * Audyt karoserii — screenshot + probe na każde auto (garaż 3D).
 * Wymaga: npm run build:web:desktop
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "screenshots", "cars-audit");
mkdirSync(OUT, { recursive: true });

const CARS = (
	process.env.IGNITE_AUDIT_CARS?.split(",") ?? [
		"octane",
		"muscle",
		"sleek",
		"hatch",
		"truck",
		"blade",
		"buggy",
		"phantom",
		"bruiser",
	]
).map((s) => s.trim());

const WHEEL = process.env.IGNITE_AUDIT_WHEEL ?? "default";
const SNAP_WARN = Number(process.env.IGNITE_AUDIT_SNAP_WARN ?? "0.12");
/** PLAYFIELD_SURFACE_Y + WHEEL_GROUND_CLEARANCE — musi trafić ze stykiem opony w probe. */
const CONTACT_Y = 0.072;
const CONTACT_TOL = 0.012;

function resolveAuditWheelForCar(carId) {
	const catalog = JSON.parse(
		readFileSync(join(ROOT, "public/assets/cars/car-catalog.json"), "utf8"),
	);
	const entry = catalog.cars.find((c) => c.id === carId);
	if (!entry) return WHEEL;
	if (WHEEL !== "default" && WHEEL !== "factory") return WHEEL;
	return entry.defaultWheelId ?? "default";
}
const MIME = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".glb": "model/gltf-binary",
	".wasm": "application/wasm",
	".ttf": "font/ttf",
};

function serve(port) {
	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			let p = (req.url ?? "/").split("?")[0];
			if (p === "/") p = "/index.html";
			const file = join(DIST, p);
			if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
				res.writeHead(404);
				res.end("404");
				return;
			}
			res.writeHead(200, {
				"Content-Type": MIME[extname(file)] ?? "application/octet-stream",
			});
			res.end(readFileSync(file));
		});
		server.listen(port, "127.0.0.1", () => resolve(server));
	});
}

const port = Number(process.env.IGNITE_AUDIT_PORT ?? 5197);
const server = await serve(port);
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch({
	headless: true,
	...(chromiumPath ? { executablePath: chromiumPath } : {}),
	args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const report = { stamp, wheel: WHEEL, cars: [] };

for (const carId of CARS) {
	const wheel = resolveAuditWheelForCar(carId);
	const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
	const url = `http://127.0.0.1:${port}/?garageAudit=1&car=${carId}&wheel=${wheel}`;
	console.log(`\n=== ${carId} (wheel=${wheel}) → ${url}`);

	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180_000 });
	await page.waitForFunction(
		() => typeof window.__igniteWheelAuditProbe === "function",
		{ timeout: 180_000 },
	);
	await page.waitForTimeout(2500);

	const probe = await page.evaluate(() => window.__igniteWheelAuditProbe?.() ?? null);
	const meshes = await page.evaluate(() => window.__igniteWheelAuditMeshes?.() ?? []);
	const shotPath = join(OUT, `${carId}-${wheel}-${stamp}.png`);
	await page.screenshot({ path: shotPath, fullPage: false });

	const snap = probe?.wheelSnapDelta;
	const rimContact = probe?.rimFlGeomMinWorldY;
	const contactOk =
		typeof rimContact === "number" &&
		Math.abs(rimContact - CONTACT_Y) <= CONTACT_TOL;
	if (typeof snap === "number" && Math.abs(snap) > SNAP_WARN) {
		if (!contactOk) {
			console.warn(
				`WARN ${carId}: |wheelSnapDelta|=${Math.abs(snap).toFixed(3)} > ${SNAP_WARN} i styk=${rimContact?.toFixed?.(3) ?? "?"} — sprawdź huby / felgę`,
			);
		} else {
			console.log(
				`INFO ${carId}: korekta hubów |wheelSnapDelta|=${Math.abs(snap).toFixed(3)} — styk opony OK (${rimContact.toFixed(3)})`,
			);
		}
	}

	report.cars.push({ carId, wheel, probe, meshes, screenshot: shotPath, url });
	console.log("probe:", JSON.stringify(probe));
	console.log("meshes:", JSON.stringify(meshes.slice(0, 12)));
	await page.close();
}

await browser.close();
server.close();

const jsonPath = join(OUT, `audit-${stamp}.json`);
writeFileSync(jsonPath, JSON.stringify(report, null, 2));
console.log(`\nReport: ${jsonPath}`);
