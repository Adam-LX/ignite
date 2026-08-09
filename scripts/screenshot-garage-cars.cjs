/**
 * Electron — screeny garageAudit dla weryfikacji orientacji.
 *   bash scripts/screenshot-garage-cars.sh
 */
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const outDir =
	process.env.IGNITE_SHOT_OUT ||
	path.join(__dirname, "../public/assets/cars/.work/diag/screens");
const base = (process.env.IGNITE_VITE_URL || "http://127.0.0.1:5173").replace(
	/\?.*$/,
	"",
).replace(/\/$/, "");
const cars = (
	process.env.IGNITE_SHOT_CARS ||
	"muscle,truck,hatch,buggy,blade,phantom,bruiser,sleek"
).split(",").map((s) => s.trim()).filter(Boolean);

fs.mkdirSync(outDir, { recursive: true });
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
	const win = new BrowserWindow({
		width: 1600,
		height: 900,
		show: false,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
		},
	});

	for (const car of cars) {
		const url = `${base}/?garageAudit=1&car=${encodeURIComponent(car)}&t=${Date.now()}`;
		console.log("→", car);
		await win.loadURL(url);
		await new Promise((r) => setTimeout(r, 7000));
		const img = await win.webContents.capturePage();
		const file = path.join(outDir, `${car}.png`);
		fs.writeFileSync(file, img.toPNG());
		console.log("  saved", file, fs.statSync(file).size, "B");
	}

	app.quit();
});
