/**
 * Runtime audit: body lacquer readable for blue + orange in match.
 *   nix develop -c node scripts/audit-car-colors.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const OUT = join(process.cwd(), "test-results", "car-black-audit");
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
await page.addInitScript(() => {
	try {
		localStorage.setItem("ignite.seenBootCinematic.v1", "1");
	} catch {
		/* */
	}
});

const url = `${BASE}/?autostart=1v1&skipIntro=1&t=${Date.now()}`;
console.log("goto", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(
	() => (window.__igniteSession?.cars?.length ?? 0) >= 2,
	null,
	{ timeout: 120000 },
);
await page.waitForTimeout(2500);

const diag = await page.evaluate(() => {
	const luma = (hex) => {
		const r = ((hex >> 16) & 255) / 255;
		const g = ((hex >> 8) & 255) / 255;
		const b = (hex & 255) / 255;
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const s = window.__igniteSession;
	const rows = [];
	for (const car of s.cars) {
		const root = car.player?.visualRoot;
		if (!root) continue;
		let body = null;
		root.traverse((o) => {
			if (o.isMesh && o.name === "body") body = o;
		});
		const mat = body
			? Array.isArray(body.material)
				? body.material[0]
				: body.material
			: null;
		const hex = mat?.color?.getHex?.() ?? 0;
		const isTeamSolid =
			hex === 0x2eb6e0 ||
			hex === 0xff7a44 ||
			hex === 0x36c8f0 ||
			hex === 0xff8a4a ||
			hex === 0x1ec8ee ||
			hex === 0xff5522 ||
			hex === 0xff6a38;
		rows.push({
			team: car.team ?? car.visualTeam,
			carId: root.userData?.carId ?? "?",
			color: `#${hex.toString(16).padStart(6, "0")}`,
			luma: +luma(hex).toFixed(3),
			emI: +Number(mat?.emissiveIntensity ?? 0).toFixed(3),
			metal: +Number(mat?.metalness ?? 0).toFixed(3),
			map: !!mat?.map,
			natural: mat?.userData?.naturalAlbedo === true,
			toneMapped: mat?.toneMapped ?? null,
			fog: mat?.fog ?? null,
			ok:
				!!mat &&
				mat.metalness <= 0.2 &&
				mat.toneMapped === false &&
				mat.emissiveIntensity >= 0.1 &&
				mat.emissiveIntensity <= 0.55 &&
				/** Bez paint: nie solid team cyan/orange — kolory jak w garażu. */
				(mat.userData?.naturalAlbedo === true
					? !isTeamSolid && (mat.map ? luma(hex) >= 0.85 : luma(hex) >= 0.28)
					: luma(hex) >= 0.28),
		});
	}
	s.match?.setCountdownHold?.(true);
	return rows;
});

/** Zbliżenie na każde auto — weryfikacja wizualna koloru. */
for (const team of ["blue", "orange"]) {
	await page.evaluate((t) => {
		const s = window.__igniteSession;
		const r = window.__igniteMatchDeps.renderer;
		const car = s.cars.find((c) => (c.team ?? c.visualTeam) === t);
		const pos = car.player.getPosition();
		const cam = r.threeJSCamera;
		cam.position.set(pos.x + 4.2, pos.y + 2.4, pos.z + 4.2);
		cam.lookAt(pos.x, pos.y + 0.55, pos.z);
		cam.updateMatrixWorld(true);
	}, team);
	await page.waitForTimeout(200);
	await page.screenshot({ path: join(OUT, `${team}-close-v98.png`) });
}

await page.screenshot({ path: join(OUT, "match-v98.png") });
writeFileSync(join(OUT, "diag-v98.json"), JSON.stringify(diag, null, 2));
console.log(JSON.stringify(diag, null, 2));

const pass =
	diag.length >= 2 &&
	diag.every((r) => r.ok) &&
	diag.some((r) => r.team === "blue") &&
	diag.some((r) => r.team === "orange");
console.log(
	pass ? "PASS car colors readable" : "FAIL car colors",
	`n=${diag.length}`,
);
await browser.close();
process.exit(pass ? 0 : 1);
