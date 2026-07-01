const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MP_PORT = process.env.IGNITE_MP_PORT || "8765";

function detectSteamDeck() {
	if (process.env.STEAM_DECK === "1" || process.env.SteamDeck === "1") {
		return true;
	}
	const steamRoot = path.join(os.homedir(), ".steam", "steam");
	try {
		return fs.existsSync(steamRoot);
	} catch {
		return false;
	}
}

function getLanIp() {
	const nets = os.networkInterfaces();
	for (const name of Object.keys(nets)) {
		for (const net of nets[name] ?? []) {
			if (net.family === "IPv4" && !net.internal) {
				return net.address;
			}
		}
	}
	return null;
}

/** Adres publicznego relay z buildu. */
function readBundledMpEndpoint() {
	const env = process.env.IGNITE_MP_SERVER?.trim();
	if (env) return env;
	try {
		const file = path.join(__dirname, "..", "dist", "mp-endpoint.json");
		const data = JSON.parse(fs.readFileSync(file, "utf8"));
		return String(data.server ?? "").trim();
	} catch {
		return "";
	}
}

const lanIp = getLanIp();
let discoveredLanMpUrls = [];

async function refreshLanDiscovery() {
	try {
		const urls = await ipcRenderer.invoke("ignite:getLanMpServers");
		if (Array.isArray(urls)) discoveredLanMpUrls = urls;
	} catch {
		/* brak IPC poza Electron */
	}
}

void refreshLanDiscovery();
setInterval(() => void refreshLanDiscovery(), 4000);

contextBridge.exposeInMainWorld("__igniteDesktop", {
	platform: "electron",
	fullscreen: true,
	steamDeck: detectSteamDeck(),
	mpServer: readBundledMpEndpoint(),
	localMpServer: `localhost:${MP_PORT}`,
	lanMpUrl: lanIp ? `ws://${lanIp}:${MP_PORT}` : "",
	getDiscoveredLanMpUrls: () => [...discoveredLanMpUrls],
});
