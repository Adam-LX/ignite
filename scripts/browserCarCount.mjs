import { chromium } from "playwright";

const browser = await chromium.launch({
	headless: true,
	executablePath: "/run/current-system/sw/bin/chromium",
	args: [
		"--no-sandbox",
		"--disable-gpu",
		"--use-gl=angle",
		"--use-angle=swiftshader",
	],
});
const page = await browser.newPage();

const logs = [];
const errors = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => errors.push(e.message));

let snapshot = { ok: false, reason: "not run" };

try {
await page.goto("http://localhost:5173/?mode=1v1", {
	waitUntil: "domcontentloaded",
	timeout: 60000,
});

await page.waitForFunction(
	() => document.getElementById("loading")?.classList.contains("hidden"),
	undefined,
	{ timeout: 120000 },
).catch(() => null);

const preMenu = await page.evaluate(() => ({
	loadingHidden: document.getElementById("loading")?.classList.contains("hidden"),
	loadingStatus: document.getElementById("loading-status")?.textContent?.trim(),
	error: document.getElementById("error-msg")?.textContent?.trim(),
	hasMenu: !!document.getElementById("main-menu"),
	hasStart: !!document.getElementById("main-menu-start"),
	menuHidden: document.getElementById("main-menu")?.classList.contains("hidden"),
}));
console.log("PRE-MENU", JSON.stringify(preMenu));

await page.waitForSelector("#main-menu-start", { state: "visible", timeout: 30000 });
await page.click("#main-menu-start");

await page.waitForFunction(
	() => window.__igniteSession?.cars?.length > 0,
	undefined,
	{ timeout: 20000 },
).catch(() => null);

await page.waitForTimeout(2000);

	snapshot = await page.evaluate(() => {
	const session = window.__igniteSession;
	if (!session) {
		return { ok: false, reason: "brak __igniteSession" };
	}
	const cars = session.cars.map((c) => ({
		slot: c.slotIndex,
		human: c.isHuman,
		name: c.displayName,
		team: c.visualTeam,
		pos: c.player.getPosition(),
		visible: c.player.threeJSGroup.visible,
		inScene: c.player.threeJSGroup.parent !== null,
	}));
	let octaneMeshes = 0;
	session.cars[0]?.player.threeJSGroup.parent?.parent?.traverse?.((o) => {
		if (o.name === "octaneCar") octaneMeshes++;
	});
	// policz octaneCar w całej scenie przez pierwszy car's scene root
	const sceneRoot = session.cars[0]?.player.threeJSGroup;
	let scene = sceneRoot;
	while (scene?.parent) scene = scene.parent;
	let octaneInScene = 0;
	scene?.traverse?.((o) => {
		if (o.name === "octaneCar") octaneInScene++;
	});
	let markerCount = 0;
	scene?.traverse?.((o) => {
		if (o.type === "Mesh" && o.geometry?.type === "SphereGeometry") markerCount++;
	});
	return {
		ok: cars.length >= 2,
		carCount: cars.length,
		cars,
		octaneInScene,
		markerSpheres: markerCount,
		errorMsg: document.getElementById("error-msg")?.textContent?.trim() ?? "",
	};
});

console.log("=== SNAPSHOT ===");
console.log(JSON.stringify(snapshot, null, 2));
} catch (err) {
	console.error("TEST FAILED:", err.message);
}

if (errors.length) {
	console.log("=== PAGE ERRORS ===");
	for (const e of errors) console.log(e);
}

const igniteLogs = logs.filter((l) => l.includes("Ignite") || l.includes("error") || l.includes("Error"));
if (igniteLogs.length) {
	console.log("=== RELEVANT CONSOLE ===");
	for (const l of igniteLogs) console.log(l);
}

await browser.close();

if (!snapshot.ok) {
	console.log("=== LAST 30 CONSOLE LINES ===");
	for (const l of logs.slice(-30)) console.log(l);
}

process.exit(snapshot.ok ? 0 : 1);
