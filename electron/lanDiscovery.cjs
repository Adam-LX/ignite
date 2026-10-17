const dgram = require("dgram");
const os = require("os");

/** Multicast LAN beacon — `_ignite-mp` bez zewnętrznych zależności (Avahi/mDNS). */
const MCAST_ADDR = "239.255.77.77";
const MCAST_PORT = 48765;
const ADVERTISE_MS = 3000;
const STALE_MS = 14_000;

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

class LanDiscovery {
	constructor(mpPort) {
		this.mpPort = String(mpPort);
		/** @type {Map<string, number>} */
		this.hosts = new Map();
		this.socket = null;
		this.advertiseTimer = null;
	}

	start() {
		if (this.socket) return;

		const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
		sock.on("error", (err) => {
			console.warn("[Ignite LAN]", err.message);
		});

		sock.on("message", (msg) => {
			try {
				const data = JSON.parse(msg.toString("utf8"));
				if (data.service !== "ignite-mp") return;
				const host = String(data.host ?? "").trim();
				const port = Number(data.port);
				if (!host || !Number.isFinite(port)) return;
				const self = getLanIp();
				if (self && host === self && port === Number(this.mpPort)) return;
				this.hosts.set(`ws://${host}:${port}`, Date.now());
			} catch {
				/* ignore malformed */
			}
		});

		sock.bind(MCAST_PORT, () => {
			try {
				sock.addMembership(MCAST_ADDR);
			} catch (err) {
				console.warn("[Ignite LAN] multicast:", err.message);
			}
			this.advertise();
			this.advertiseTimer = setInterval(() => this.advertise(), ADVERTISE_MS);
		});

		this.socket = sock;
	}

	advertise() {
		const ip = getLanIp();
		if (!ip || !this.socket) return;
		const payload = Buffer.from(
			JSON.stringify({
				service: "ignite-mp",
				host: ip,
				port: Number(this.mpPort),
			}),
		);
		this.socket.send(payload, MCAST_PORT, MCAST_ADDR, (err) => {
			if (err) console.warn("[Ignite LAN] advertise:", err.message);
		});
	}

	getDiscoveredUrls() {
		const now = Date.now();
		const out = [];
		for (const [url, ts] of this.hosts) {
			if (now - ts <= STALE_MS) out.push(url);
			else this.hosts.delete(url);
		}
		return out;
	}

	stop() {
		if (this.advertiseTimer) {
			clearInterval(this.advertiseTimer);
			this.advertiseTimer = null;
		}
		if (this.socket) {
			this.socket.close();
			this.socket = null;
		}
	}
}

module.exports = { LanDiscovery, getLanIp };
