const { app, BrowserWindow, shell, ipcMain, nativeImage, screen } = require("electron");
const { execFile, fork } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { pathToFileURL } = require("url");
const { LanDiscovery } = require("./lanDiscovery.cjs");

/** Muzyka w menu bez kliknięcia — Chromium inaczej blokuje AudioContext. */
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const execFileAsync = promisify(execFile);

async function publishClipLatestForAgent({ videoPath, baseName, inputLogJson }) {
	try {
		const modUrl = pathToFileURL(
			path.join(__dirname, "..", "scripts", "publishGameplayClipLatest.mjs"),
		).href;
		const { publishGameplayClipLatest } = await import(modUrl);
		publishGameplayClipLatest({
			repoRoot: path.join(__dirname, ".."),
			videoPath,
			baseName,
			inputLogJson: inputLogJson || null,
			videosPath: videoPath,
		});
	} catch (err) {
		console.warn("[ignite] clip latest publish fail", err);
	}
}

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
/** Aktywne okno gry — capturePage dla F9. */
let mainWindow = null;

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
	const windowed = process.env.IGNITE_WINDOWED === "1";
	/**
	 * Domyślnie: bezramkowe + pełny ekran (bounds displaya, BEZ exclusive FS).
	 * Exclusive fullscreen na Wayland/NVIDIA = ghost WebGL (YOU≠auto).
	 * IGNITE_FULLSCREEN=1 → exclusive FS (na własne ryzyko).
	 * IGNITE_WINDOWED=1 → zwykłe okno z titlebarem.
	 */
	const exclusiveFs =
		!windowed && process.env.IGNITE_FULLSCREEN === "1";
	const primary =
		screen.getPrimaryDisplay?.() ??
		screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	const cover = primary?.bounds ?? { x: 0, y: 0, width: 1920, height: 1080 };
	const win = new BrowserWindow({
		x: windowed ? undefined : cover.x,
		y: windowed ? undefined : cover.y,
		width: windowed ? 1600 : steamDeck ? 1280 : cover.width,
		height: windowed ? 900 : steamDeck ? 800 : cover.height,
		fullscreen: exclusiveFs,
		frame: windowed,
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
	mainWindow = win;
	win.on("closed", () => {
		if (mainWindow === win) mainWindow = null;
	});

	win.setMenuBarVisibility(false);
	if (gameUrl) {
		void win.loadURL(gameUrl);
	} else {
		void win.loadFile(resolveIndexHtml());
	}

	const enterBorderlessCover = () => {
		if (windowed || exclusiveFs) return;
		const display = screen.getDisplayMatching(win.getBounds());
		const bounds = display?.bounds ?? cover;
		/** Bez maximize() — na GNOME to workArea + „okno maximized”; bounds = edge-to-edge. */
		win.setBounds(bounds);
	};

	/** Od razu, jeszcze przed load — intro nie startuje w zwykłym maximize. */
	if (exclusiveFs) {
		win.setFullScreen(true);
	} else if (!windowed) {
		enterBorderlessCover();
	}

	win.once("ready-to-show", () => {
		if (exclusiveFs) {
			win.setFullScreen(true);
		} else if (!windowed) {
			enterBorderlessCover();
		}
		win.show();
		win.focus();
		win.webContents
			.executeJavaScript(
				`window.dispatchEvent(new Event("resize")); undefined`,
			)
			.catch(() => {});
		/** Wayland: layout bywa 1 klatkę później. */
		setTimeout(() => {
			enterBorderlessCover();
			win.webContents
				.executeJavaScript(
					`window.dispatchEvent(new Event("resize")); undefined`,
				)
				.catch(() => {});
		}, 40);
	});

	win.webContents.once("did-finish-load", () => {
		if (!windowed && !exclusiveFs) enterBorderlessCover();
	});

	win.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	win.on("enter-full-screen", () => {
		win.webContents
			.executeJavaScript(
				`window.dispatchEvent(new Event("resize")); undefined`,
			)
			.catch(() => {});
	});
	win.on("leave-full-screen", () => {
		if (!windowed && !exclusiveFs) enterBorderlessCover();
		win.webContents
			.executeJavaScript(
				`window.dispatchEvent(new Event("resize")); undefined`,
			)
			.catch(() => {});
	});

	win.on("resize", () => {
		win.webContents
			.executeJavaScript(
				`window.dispatchEvent(new Event("resize")); undefined`,
			)
			.catch(() => {});
	});

	if (process.env.IGNITE_CAPTURE_LOCK === "1") {
		win.on("close", (e) => {
			e.preventDefault();
			console.log("[Ignite] capture lock — ignore window close");
		});
	}

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

	ipcMain.removeHandler("ignite:enterBorderless");
	ipcMain.handle("ignite:enterBorderless", () => {
		enterBorderlessCover();
		return true;
	});

	ipcMain.removeHandler("ignite:saveGameplayClip");
	ipcMain.removeHandler("ignite:captureGameplayFrame");
	ipcMain.handle("ignite:captureGameplayFrame", async () => {
		try {
			const w = mainWindow;
			if (!w || w.isDestroyed()) return null;
			let img = await w.capturePage();
			if (img.isEmpty()) return null;
			const size = img.getSize();
			const maxW = 1280;
			if (size.width > maxW) {
				const h = Math.max(2, Math.round((size.height * maxW) / size.width));
				img = img.resize({
					width: maxW - (maxW % 2),
					height: h - (h % 2),
					quality: "good",
				});
			}
			/** 65 — szybsze IPC przy ciężkiej scenie (grube bramki). */
			const jpeg = img.toJPEG(65);
			return jpeg.buffer.slice(
				jpeg.byteOffset,
				jpeg.byteOffset + jpeg.byteLength,
			);
		} catch {
			return null;
		}
	});

	ipcMain.handle("ignite:saveGameplayClip", async (_event, payload) => {
		const logErr = (msg) => {
			try {
				const p = path.join(
					__dirname,
					"..",
					"data",
					"gameplay-clips",
					"last-error.txt",
				);
				fs.mkdirSync(path.dirname(p), { recursive: true });
				fs.writeFileSync(
					p,
					`${new Date().toISOString()}\n${msg}\n`,
					"utf8",
				);
			} catch {
				/* ignore */
			}
			console.error("[ignite-clip]", msg);
		};
		try {
			const bytes = payload?.bytes;
			const baseName = String(payload?.baseName ?? "ignite-clip").replace(
				/[^\w.\-]+/g,
				"_",
			);
			const toBuf = (raw) => {
				if (!raw) return null;
				if (Buffer.isBuffer(raw)) return raw;
				if (raw instanceof ArrayBuffer) return Buffer.from(raw);
				if (ArrayBuffer.isView(raw)) {
					return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
				}
				if (Array.isArray(raw)) return Buffer.from(raw);
				if (raw.type === "Buffer" && Array.isArray(raw.data)) {
					return Buffer.from(raw.data);
				}
				return null;
			};
			const buf = toBuf(bytes);
			if (!buf || buf.length < 12) {
				const msg = `Brak danych wideo (type=${bytes == null ? "null" : typeof bytes}, len=${buf?.length ?? 0})`;
				logErr(msg);
				return { ok: false, error: msg };
			}
			const dir = resolveVideosDir();
			fs.mkdirSync(dir, { recursive: true });
			const mime = String(payload?.mime ?? "").toLowerCase();
			const mp4Path = path.join(dir, `${baseName}.mp4`);

			const inputLogJson =
				typeof payload?.inputLogJson === "string" && payload.inputLogJson.length > 2
					? payload.inputLogJson
					: null;
			if (inputLogJson) {
				try {
					fs.writeFileSync(
						path.join(dir, `${baseName}.inputs.json`),
						inputLogJson,
						"utf8",
					);
				} catch {
					/* meta opcjonalne */
				}
			}

			/** Pakiet JPEG z F9 (nie MediaRecorder). */
			if (
				mime.includes("ignite-frames") ||
				(buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "IGNF")
			) {
				const {
					encodeIgniteFramesToMp4,
				} = await import(
					`${pathToFileURL(
						path.join(__dirname, "..", "scripts", "igniteClipFrames.mjs"),
					).href}?t=${Date.now()}`
				);
				const encoded = await encodeIgniteFramesToMp4(buf, mp4Path);
				if (!encoded.ok) {
					logErr(encoded.error ?? "encode frames fail");
					return { ok: false, error: encoded.error ?? "encode frames fail" };
				}
				await publishClipLatestForAgent({
					videoPath: mp4Path,
					baseName,
					inputLogJson,
				});
				return { ok: true, path: mp4Path };
			}

			if (buf.length < 80_000) {
				const msg = `Wideo za małe (${buf.length} B) — czarne klatki? Hard-reload i F9`;
				logErr(msg);
				return { ok: false, error: msg };
			}

			const alreadyMp4 = mime.includes("mp4");
			const webmPath = path.join(dir, `${baseName}.webm`);
			const rawPath = alreadyMp4 ? mp4Path : webmPath;
			fs.writeFileSync(rawPath, buf);

			if (alreadyMp4) {
				await publishClipLatestForAgent({
					videoPath: mp4Path,
					baseName,
					inputLogJson,
				});
				return { ok: true, path: mp4Path };
			}

			try {
				await execFileAsync(
					"ffmpeg",
					[
						"-y",
						"-i",
						webmPath,
						"-c:v",
						"libx264",
						"-preset",
						"veryfast",
						"-crf",
						"20",
						"-pix_fmt",
						"yuv420p",
						"-movflags",
						"+faststart",
						"-an",
						mp4Path,
					],
					{ timeout: 120_000 },
				);
				let outPath = mp4Path;
				try {
					if (fs.statSync(mp4Path).size < 64) {
						outPath = webmPath;
						try {
							fs.unlinkSync(mp4Path);
						} catch {
							/* ignore */
						}
					} else {
						try {
							fs.unlinkSync(webmPath);
						} catch {
							/* ignore */
						}
					}
				} catch {
					outPath = webmPath;
				}
				await publishClipLatestForAgent({
					videoPath: outPath,
					baseName,
					inputLogJson,
				});
				return { ok: true, path: outPath };
			} catch (err) {
				await publishClipLatestForAgent({
					videoPath: webmPath,
					baseName,
					inputLogJson,
				});
				return {
					ok: true,
					path: webmPath,
					error:
						err instanceof Error
							? `ffmpeg: ${err.message} — zapisano WebM`
							: "ffmpeg fail — zapisano WebM",
				};
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : "save fail";
			try {
				const p = path.join(
					__dirname,
					"..",
					"data",
					"gameplay-clips",
					"last-error.txt",
				);
				fs.mkdirSync(path.dirname(p), { recursive: true });
				fs.writeFileSync(p, `${new Date().toISOString()}\n${msg}\n`, "utf8");
			} catch {
				/* ignore */
			}
			console.error("[ignite-clip]", msg);
			return {
				ok: false,
				error: msg,
			};
		}
	});

	return win;
}

/** ~/Wideo (PL) → ~/Videos → app.getPath('videos'). */
function resolveVideosDir() {
	const home = os.homedir();
	const candidates = [
		path.join(home, "Wideo"),
		path.join(home, "Videos"),
		typeof app.getPath === "function" ? app.getPath("videos") : "",
	].filter(Boolean);
	for (const dir of candidates) {
		try {
			if (fs.existsSync(dir)) return dir;
		} catch {
			/* next */
		}
	}
	const fallback =
		process.platform === "win32"
			? app.getPath("videos")
			: path.join(home, "Wideo");
	fs.mkdirSync(fallback, { recursive: true });
	return fallback;
}

app.whenReady().then(async () => {
	app.setName("Ignite");
	if (process.platform === "linux") {
		app.setDesktopName?.("ignite.desktop");
	}
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
	if (process.env.IGNITE_CAPTURE_LOCK === "1") {
		console.log("[Ignite] capture lock — keep app alive (no windows)");
		return;
	}
	lanDiscovery?.stop();
	lanDiscovery = null;
	stopMpServer();
	stopGameHttpServer();
	app.quit();
});
