import { pluralForm, t } from "../i18n";
import { DEFAULT_MP_PORT, mpHttpBaseUrl, parseServerAddress } from "./protocol";

export type OnlineServerStatus = {
	playersOnline: number;
	inMatch: number;
	matches: number;
	waitingRooms: number;
	rooms: number;
	botGeneration?: number;
	botGlobalMatches?: number;
	rankedPlayers?: number;
};

export type OpenRoomInfo = {
	code: string;
	ranked?: boolean;
	mode?: string;
	players?: number;
	maxPlayers?: number;
	botsWillFill?: number;
};

export type MpEndpointConfig = {
	server?: string;
	local?: string;
	lan?: string;
};

type IgniteDesktopBridge = {
	mpServer?: string;
	localMpServer?: string;
	lanMpUrl?: string;
	getDiscoveredLanMpUrls?: () => string[];
};

let cachedEndpointConfig: MpEndpointConfig | null = null;
let endpointConfigPromise: Promise<MpEndpointConfig> | null = null;
let resolvedServerAddress: string | null = null;
let resolvePromise: Promise<string> | null = null;

function desktopBridge(): IgniteDesktopBridge | undefined {
	if (typeof window === "undefined") return undefined;
	return (window as unknown as { __igniteDesktop?: IgniteDesktopBridge })
		.__igniteDesktop;
}

async function loadMpEndpointConfig(): Promise<MpEndpointConfig> {
	if (cachedEndpointConfig) return cachedEndpointConfig;
	if (endpointConfigPromise) return endpointConfigPromise;

	endpointConfigPromise = (async () => {
		const config: MpEndpointConfig = {};
		try {
			const res = await fetch("/mp-endpoint.json", { cache: "no-store" });
			if (res.ok) {
				const data = (await res.json()) as MpEndpointConfig;
				if (data.server?.trim()) config.server = data.server.trim();
				if (data.local?.trim()) config.local = data.local.trim();
				if (data.lan?.trim()) config.lan = data.lan.trim();
			}
		} catch {
			/* brak pliku — fallback poniżej */
		}

		const desktop = desktopBridge();
		if (desktop?.mpServer?.trim()) config.server = desktop.mpServer.trim();
		if (desktop?.localMpServer?.trim()) {
			config.local = desktop.localMpServer.trim();
		}
		if (desktop?.lanMpUrl?.trim()) config.lan = desktop.lanMpUrl.trim();

		cachedEndpointConfig = config;
		return config;
	})();

	try {
		return await endpointConfigPromise;
	} finally {
		endpointConfigPromise = null;
	}
}

/** Kolejność: publiczny relay → LAN → lokalny Electron → hostname dev → localhost. */
export function collectMpServerCandidates(
	config: MpEndpointConfig = {},
): string[] {
	const out: string[] = [];
	const push = (raw?: string) => {
		const trimmed = raw?.trim();
		if (!trimmed) return;
		if (!out.includes(trimmed)) out.push(trimmed);
	};

	push(config.server);
	push(desktopBridge()?.mpServer);
	push(import.meta.env.VITE_IGNITE_MP_SERVER);
	push(config.lan);
	push(desktopBridge()?.lanMpUrl);
	for (const url of desktopBridge()?.getDiscoveredLanMpUrls?.() ?? []) {
		push(url);
	}
	push(config.local);
	push(desktopBridge()?.localMpServer);

	if (typeof window !== "undefined") {
		const host = window.location.hostname;
		if (host && host !== "localhost" && host !== "127.0.0.1") {
			push(`${host}:${DEFAULT_MP_PORT}`);
		}
	}

	push(`localhost:${DEFAULT_MP_PORT}`);
	return out;
}

/** Adres serwera MP (sync) — po resolveMpServerAddress lub heurystyka. */
export function getMpServerAddress(): string {
	if (resolvedServerAddress) return resolvedServerAddress;

	if (typeof window === "undefined") {
		return `localhost:${DEFAULT_MP_PORT}`;
	}

	const desktop = desktopBridge();
	const bundled = desktop?.mpServer?.trim();
	if (bundled) return bundled;

	const vite = import.meta.env.VITE_IGNITE_MP_SERVER?.trim();
	if (vite) return vite;

	if (cachedEndpointConfig?.server) return cachedEndpointConfig.server;
	if (cachedEndpointConfig?.local) return cachedEndpointConfig.local;

	if (window.location.protocol === "file:") {
		return desktop?.localMpServer?.trim() ?? `localhost:${DEFAULT_MP_PORT}`;
	}

	const host = window.location.hostname;
	if (!host) return `localhost:${DEFAULT_MP_PORT}`;
	return `${host}:${DEFAULT_MP_PORT}`;
}

/** Wczytuje /mp-endpoint.json (bez sondowania). */
export async function primeMpServerAddress(): Promise<string> {
	await loadMpEndpointConfig();
	return resolveMpServerAddress();
}

/** Wybiera pierwszy działający serwer (internet → LAN → lokalny). */
export async function resolveMpServerAddress(): Promise<string> {
	if (resolvedServerAddress) return resolvedServerAddress;
	if (resolvePromise) return resolvePromise;

	resolvePromise = (async () => {
		const config = await loadMpEndpointConfig();
		const candidates = collectMpServerCandidates(config);

		for (const raw of candidates) {
			const status = await fetchOnlineStatus(raw);
			if (status) {
				resolvedServerAddress = raw;
				return raw;
			}
		}

		resolvedServerAddress = candidates[0] ?? `localhost:${DEFAULT_MP_PORT}`;
		return resolvedServerAddress;
	})();

	try {
		return await resolvePromise;
	} finally {
		resolvePromise = null;
	}
}

export function formatOnlineCount(status: OnlineServerStatus | null): string {
	if (!status) return t("server.offline");

	const parts: string[] = [];
	if (status.waitingRooms > 0) {
		const key = pluralForm(status.waitingRooms, {
			one: "server.waitingRoomOne",
			few: "server.waitingRoomFew",
			many: "server.waitingRoomMany",
		});
		parts.push(t(key, { n: status.waitingRooms }));
	}
	if (status.matches > 0) {
		const key = pluralForm(status.matches, {
			one: "server.matchOne",
			few: "server.matchFew",
			many: "server.matchMany",
		});
		parts.push(t(key, { n: status.matches }));
	}
	if (status.playersOnline > 0) {
		const key = pluralForm(status.playersOnline, {
			one: "server.playerOne",
			few: "server.playerFew",
			many: "server.playerMany",
		});
		parts.push(t(key, { n: status.playersOnline }));
	}
	if (status.botGeneration != null && status.botGeneration > 0) {
		parts.push(t("server.botGen", { n: status.botGeneration }));
	}

	if (parts.length === 0) return t("server.onlineEmpty");
	return parts.join(" · ");
}

export async function fetchOnlineStatus(
	serverRaw = getMpServerAddress(),
): Promise<OnlineServerStatus | null> {
	const base = mpHttpBaseUrl(serverRaw);
	const controller = new AbortController();
	const timeout = window.setTimeout(() => controller.abort(), 3000);

	try {
		const res = await fetch(`${base}/status`, {
			signal: controller.signal,
			cache: "no-store",
		});
		if (!res.ok) return null;
		return (await res.json()) as OnlineServerStatus;
	} catch {
		return null;
	} finally {
		window.clearTimeout(timeout);
	}
}

export async function fetchOpenRooms(
	serverRaw = getMpServerAddress(),
): Promise<OpenRoomInfo[] | null> {
	const base = mpHttpBaseUrl(serverRaw);
	const controller = new AbortController();
	const timeout = window.setTimeout(() => controller.abort(), 3000);

	try {
		const res = await fetch(`${base}/rooms`, {
			signal: controller.signal,
			cache: "no-store",
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { rooms?: OpenRoomInfo[] };
		return Array.isArray(data.rooms) ? data.rooms : [];
	} catch {
		return null;
	} finally {
		window.clearTimeout(timeout);
	}
}

/** host:port z aktywnego adresu (do logów / debug). */
export function describeMpServer(serverRaw = getMpServerAddress()): string {
	const { host, port } = parseServerAddress(serverRaw);
	return `${host}:${port}`;
}
