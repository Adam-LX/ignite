import { githubBotPolicyRawUrl } from "./githubBotPolicyUrl";
import { DEFAULT_MP_PORT, parseServerAddress } from "./protocol";

export type PolicyEndpointLists = {
	fetch: string[];
	sync: string[];
};

type RelayManifest = {
	fetch?: string[];
	sync?: string[];
};

type MpEndpointJson = {
	server?: string;
	local?: string;
};

let cached: PolicyEndpointLists | null = null;
let cachedAt = 0;
const CACHE_MS = 45_000;

function wssToHttp(wss: string): string {
	const trimmed = wss.trim();
	if (trimmed.startsWith("wss://")) {
		return `https://${trimmed.slice("wss://".length)}`;
	}
	if (trimmed.startsWith("ws://")) {
		return `http://${trimmed.slice("ws://".length)}`;
	}
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		return trimmed;
	}
	return `http://${trimmed}`;
}

function hostPortPolicyUrls(hostPort: string): { fetch: string; sync: string } {
	const { host, port } = parseServerAddress(hostPort);
	const base = `http://${host}:${port}`;
	return { fetch: `${base}/policy`, sync: `${base}/policy/sync` };
}

function addUnique(list: Set<string>, url: string | undefined | null): void {
	if (!url?.trim()) return;
	list.add(url.trim());
}

function addFromHostPort(
	fetch: Set<string>,
	sync: Set<string>,
	hostPort: string,
): void {
	const urls = hostPortPolicyUrls(hostPort);
	fetch.add(urls.fetch);
	sync.add(urls.sync);
}

function readEnvList(name: string): string[] {
	const raw =
		typeof import.meta !== "undefined" &&
		(import.meta.env as Record<string, string | undefined>)?.[name]
			? String((import.meta.env as Record<string, string | undefined>)[name])
			: "";
	if (!raw.trim()) return [];
	return raw
		.split(/[,;\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

function addEnvEndpoints(fetch: Set<string>, sync: Set<string>): void {
	for (const url of readEnvList("VITE_IGNITE_POLICY_FETCH_URLS")) {
		addUnique(fetch, url);
	}
	for (const url of readEnvList("VITE_IGNITE_POLICY_SYNC_URLS")) {
		addUnique(sync, url);
	}

	const canonical =
		typeof import.meta !== "undefined" &&
		import.meta.env?.VITE_IGNITE_POLICY_CANONICAL_URL
			? String(import.meta.env.VITE_IGNITE_POLICY_CANONICAL_URL).trim()
			: "";
	if (canonical) addUnique(fetch, canonical);

	const policyServer =
		typeof import.meta !== "undefined" &&
		import.meta.env?.VITE_IGNITE_POLICY_SERVER
			? String(import.meta.env.VITE_IGNITE_POLICY_SERVER).trim()
			: "";
	if (policyServer) addFromHostPort(fetch, sync, policyServer);

	const mpServer =
		typeof import.meta !== "undefined" && import.meta.env?.VITE_IGNITE_MP_SERVER
			? String(import.meta.env.VITE_IGNITE_MP_SERVER).trim()
			: "";
	if (mpServer) {
		const http = wssToHttp(mpServer);
		addUnique(fetch, `${http}/policy`);
		addUnique(sync, `${http}/policy/sync`);
	}

	addUnique(fetch, githubBotPolicyRawUrl());
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T | null> {
	if (typeof fetch === "undefined") return null;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			cache: "no-store",
		});
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function addManifestLists(
	fetch: Set<string>,
	sync: Set<string>,
	manifest: RelayManifest | null,
): void {
	if (!manifest) return;
	for (const url of manifest.fetch ?? []) addUnique(fetch, url);
	for (const url of manifest.sync ?? []) addUnique(sync, url);
}

function addBrowserDefaults(fetch: Set<string>, sync: Set<string>): void {
	if (typeof window === "undefined") return;

	const host = window.location.hostname || "localhost";
	addFromHostPort(fetch, sync, `${host}:${DEFAULT_MP_PORT}`);

	if (host !== "localhost" && host !== "127.0.0.1") {
		addFromHostPort(fetch, sync, `localhost:${DEFAULT_MP_PORT}`);
	}
}

/** Lista URL-i do federacyjnego pobierania / wysyłania mózgu botów. */
export async function resolvePolicyEndpoints(
	force = false,
): Promise<PolicyEndpointLists> {
	const now = Date.now();
	if (!force && cached && now - cachedAt < CACHE_MS) {
		return cached;
	}

	const fetchSet = new Set<string>();
	const syncSet = new Set<string>();

	addEnvEndpoints(fetchSet, syncSet);
	addBrowserDefaults(fetchSet, syncSet);

	addUnique(fetchSet, "/assets/ai/bot-policy.json");

	const [mpEndpoint, relayManifest] = await Promise.all([
		fetchJson<MpEndpointJson>("/mp-endpoint.json", 2500),
		fetchJson<RelayManifest>("/policy-relays.json", 2500),
	]);

	if (mpEndpoint?.server) {
		const http = wssToHttp(mpEndpoint.server);
		addUnique(fetchSet, `${http}/policy`);
		addUnique(syncSet, `${http}/policy/sync`);
	}
	if (mpEndpoint?.local) {
		addFromHostPort(fetchSet, syncSet, mpEndpoint.local);
	}

	addManifestLists(fetchSet, syncSet, relayManifest);

	cached = {
		fetch: [...fetchSet],
		sync: [...syncSet],
	};
	cachedAt = now;
	return cached;
}

export function getCachedPolicyEndpoints(): PolicyEndpointLists | null {
	return cached;
}

export function invalidatePolicyEndpointCache(): void {
	cached = null;
	cachedAt = 0;
}
