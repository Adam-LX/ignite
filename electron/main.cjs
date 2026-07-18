const { app, BrowserWindow, shell, ipcMain, nativeImage } = require("electron");
const { fork } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { LanDiscovery } = require("./lanDiscovery.cjs");

const APP_ICON = path.join(__dirname, "..", "assets", "icon.png");
const MP_PORT = process.env.IGNITE_MP_PORT || "8765";
const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".glb": "model/gltf-binary",
};

let mpServerChild = null;
let gameHttpServer = null;
let gameUrl = null;
let lanDiscovery = null;

function distDir() {
	return path.join(__dirname, "..", "dist");
}

function getLanIp() {
	const nets = os.networkInterfaces();
	for (const name of Object.keys(nets)) {
		for (const iface of nets[name] ?? []) {
			if (iface.family === "IPv4" && !iface.internal) {
				return iface.address;
			}
		}
	}
	return null;
}

function readBundledPublicMpEndpoint() {
	const env = process.env.IGNITE_MP_SERVER?.trim();
	if (env) return env;
	try {
		const file = path.join(distDir(), "mp-endpoint.json");
		const data = JSON.parse(fs.readFileSync(file, "utf8"));
		return String(data.server ?? "").trim();
	} catch {
		return "";
	}
}

function buildMpEndpointPayload() {
	const lanIp = getLanIp();
	const publicServer = readBundledPublicMpEndpoint();
	const payload = {
		local: `localhost:${MP_PORT}`,
	};
	if (publicServer) payload.server = publicServer;
	if (lanIp) payload.lan = `ws://${lanIp}:${MP_PORT}`;
	return payload;
}

function resolveIndexHtml() {
	return path.join(distDir(), "index.html");
}

function mpServerPath() {
	return path.join(__dirname, "mp-server.cjs");
}

function stopMpServer() {
	if (!mpServerChild) return;
	mpServerChild.kill("SIGTERM");
	mpServerChild = null;
}

function mpGetJson(pathname) {
	return new Promise((resolve) => {
		const req = http.get(
			`http://127.0.0.1:${MP_PORT}${pathname}`,
			{ timeout: 800 },
			(res) => {
				let body = "";
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () => {
					if (res.statusCode !== 200) {
						resolve(null);
						return;
					}
					try {
						resolve(JSON.parse(body));
					} catch {
						resolve(null);
					}
				});
			},
		);
		req.on("error", () => resolve(null));
		req.on("timeout", () => {
			req.destroy();
			resolve(null);
		});
	});
}

async function mpServerHealthy() {
	const status = await mpGetJson("/status");
	const rooms = await mpGetJson("/rooms");
	return Boolean(status && rooms && Array.isArray(rooms.rooms));
}

function killListenersOnPort(port) {
	if (process.platform === "win32") return;
	try {
		const { execSync } = require("child_process");
		const out = execSync(`lsof -ti:${port}`, { encoding: "utf8" }).trim();
		for (const pid of out.split(/\s+/).filter(Boolean)) {
			if (pid === String(process.pid)) continue;
			if (mpServerChild && pid === String(mpServerChild.pid)) continue;
			try {
				process.kill(Number(pid), "SIGTERM");
			} catch {
				/* ignore */
			}
		}
	} catch {
		/* port wolny */
	}
}

function forkMpServer() {
	const script = mpServerPath();
	if (!fs.existsSync(script)) {
		console.warn("[Ignite] Brak electron/mp-server.cjs — zbuduj: npm run build:mp-server");
		return;
	}
	stopMpServer();
	mpServerChild = fork(script, [], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			IGNITE_MP_PORT: MP_PORT,
		},
		execPath: process.execPath,
		stdio: "pipe",
	});
	mpServerChild.stdout?.on("data", (chunk) => {
		process.stdout.write(`[Ignite MP] ${chunk}`);
	});
	mpServerChild.stderr?.on("data", (chunk) => {
		process.stderr.write(`[Ignite MP] ${chunk}`);
	});
	mpServerChild.on("exit", (code) => {
		mpServerChild = null;
		if (code && code !== 0) {
			console.warn(`[Ignite] Serwer MP zakończył się kodem ${code}`);
		}
	});
}

async function ensureMpServer() {
	if (await mpServerHealthy()) return;

	killListenersOnPort(MP_PORT);
	await new Promise((r) => setTimeout(r, 200));

	if (await mpServerHealthy()) return;

	forkMpServer();
	for (let i = 0; i < 50; i++) {
		if (await mpServerHealthy()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	console.warn("[Ignite] Serwer MP nie odpowiada — online może nie działać");
}

function startGameHttpServer() {
	return new Promise((resolve, reject) => {
		const root = distDir();
		const server = http.createServer((req, res) => {
			try {
				let urlPath = (req.url || "/").split("?")[0];
				if (urlPath === "/mp-endpoint.json") {
					res.writeHead(200, {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": "no-store",
					});
					res.end(JSON.stringify(buildMpEndpointPayload()));
					return;
				}
				if (urlPath === "/") urlPath = "/index.html";
				const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
				const filePath = path.join(root, safe);
				if (!filePath.startsWith(root)) {
					res.writeHead(403);
					res.end();
					return;
				}
				if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
					res.writeHead(404);
					res.end();
					return;
				}
				const ext = path.extname(filePath).toLowerCase();
				res.writeHead(200, {
					"Content-Type": MIME[ext] || "application/octet-stream",
					"Cache-Control": "no-store",
				});
				fs.createReadStream(filePath).pipe(res);
			} catch (err) {
				res.writeHead(500);
				res.end(String(err));
			}
		});
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			gameHttpServer = server;
			gameUrl = `http://127.0.0.1:${port}/`;
			const autostart = process.env.IGNITE_AUTOSTART;
			if (autostart) {
				gameUrl += `?autostart=${encodeURIComponent(autostart)}`;
			}
			resolve(gameUrl);
		});
		server.on("error", reject);
	});
}

function stopGameHttpServer() {
	if (!gameHttpServer) return;
	gameHttpServer.close();
	gameHttpServer = null;
	gameUrl = null;
}

function detectSteamDeck() {
	return process.env.STEAM_DECK === "1" || process.env.SteamDeck === "1";
}

function resolveGameUrl() {
	if (!app.isPackaged && (process.env.IGNITE_DEV === "1" || process.env.IGNITE_VITE_URL)) {
		return Promise.resolve(
			process.env.IGNITE_VITE_URL || "http://127.0.0.1:5173",
		);
	}
	return startGameHttpServer().then(() => gameUrl);
}

function createWindow() {
	const steamDeck = detectSteamDeck();
	/**
	 * Wayland + Electron `fullscreen: true` psuje WebGL (stary kadr / orbita menu
	 * mimo poprawnego threeJSCamera). Domyślnie maximize — wygląda jak fullscreen,
	 * chase działa. IGNITE_FULLSCREEN=1 wymusza exclusive FS.
	 */
	const exclusiveFs = process.env.IGNITE_FULLSCREEN === "1";
	const windowed = process.env.IGNITE_WINDOWED === "1";
	const win = new BrowserWindow({
		width: windowed ? 1600 : steamDeck ? 1280 : 1920,
		height: windowed ? 900 : steamDeck ? 800 : 1080,
		fullscreen: exclusiveFs && !windowed,
		autoHideMenuBar: true,
		backgroundColor: "#050508",
		icon: APP_ICON,
		title: "Ignite",
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			backgroundThrottling: false,
		},
	});

	win.setMenuBarVisibility(false);
	if (gameUrl) {
		void win.loadURL(gameUrl);
	} else {
		void win.loadFile(resolveIndexHtml());
	}

	win.once("ready-to-show", () => {
		if (exclusiveFs && !windowed) {
			win.setFullScreen(true);
		} else if (!windowed) {
			win.maximize();
		}
		win.show();
		/** Po maximize — wymuś resize composera / kamery. */
		win.webContents
			.executeJavaScript(
				`window.dispatchEvent(new Event("resize")); undefined`,
			)
			.catch(() => {});
	});

	win.webContents.on("render-process-gone", (_event, details) => {
		console.error("[Ignite] renderer gone:", details.reason, details.exitCode);
	});

	win.webContents.on("console-message", (_event, _level, message) => {
		const text = String(message);
		if (
			text.includes("[Boot]") ||
			text.includes("[Match]") ||
			text.includes("[Ignite showcase audit]") ||
			text.includes("[Ignite] ?canvasOnly")
		) {
			console.log(`[renderer] ${message}`);
		}
	});

	if (process.env.IGNITE_BOOT_DEBUG === "1") {
		const dump = () => {
			void win.webContents
				.executeJavaScript(
					`({
            status: document.getElementById('loading-status')?.textContent ?? '',
            loadingHidden: document.getElementById('loading')?.classList.contains('hidden'),
            boot: localStorage.getItem('ignite-boot-log') ?? '',
            match: localStorage.getItem('ignite-match-log') ?? ''
          })`,
				)
				.then((s) => console.log("[Ignite boot]", JSON.stringify(s)))
				.catch(() => {});
		};
		win.webContents.on("did-finish-load", () => {
			const t = setInterval(dump, 2000);
			win.on("closed", () => clearInterval(t));
		});
	}

	win.webContents.on("before-input-event", (_event, input) => {
		if (input.key === "F11" && input.type === "keyDown") {
			win.setFullScreen(!win.isFullScreen());
		}
		if (input.key === "Escape" && input.type === "keyDown" && input.alt) {
			app.quit();
		}
	});

	win.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});
}

app.whenReady().then(async () => {
	if (process.platform === "darwin" && fs.existsSync(APP_ICON)) {
		const icon = nativeImage.createFromPath(APP_ICON);
		if (!icon.isEmpty()) app.dock?.setIcon(icon);
	}
	ipcMain.handle("ignite:getLanMpServers", () => {
		return lanDiscovery?.getDiscoveredUrls() ?? [];
	});

	await ensureMpServer();
	lanDiscovery = new LanDiscovery(MP_PORT);
	lanDiscovery.start();
	const url = await resolveGameUrl();
	gameUrl = url;
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("before-quit", () => {
	lanDiscovery?.stop();
	lanDiscovery = null;
	stopMpServer();
	stopGameHttpServer();
});

app.on("window-all-closed", () => {
	lanDiscovery?.stop();
	lanDiscovery = null;
	stopMpServer();
	stopGameHttpServer();
	app.quit();
});
