/**
 * Trellis 3D API client — lokalny kontener :8004
 * Text-to-3D: JSON { prompt, quality, user }
 * Image-to-3D: multipart { image, quality, user }
 */

const DEFAULT_BASE = process.env.TRELLIS_URL ?? "http://127.0.0.1:8004";
const DEFAULT_USER = process.env.TRELLIS_USER ?? "Adam";

export type TrellisJobStatus = {
	status: "queued" | "running" | "done" | "error" | "cancelled";
	progress?: number;
	phase?: string;
	message?: string;
	glb_url?: string;
	view_url?: string;
	id?: string;
	out_id?: string;
	error?: string;
};

export type TrellisGenerateResponse = {
	job_id: string;
	out_id?: string;
	status: string;
	queue_position?: number;
};

export function trellisBaseUrl(): string {
	return DEFAULT_BASE.replace(/\/$/, "");
}

export function trellisUser(): string {
	return DEFAULT_USER;
}

export async function trellisHealth(base = trellisBaseUrl()): Promise<boolean> {
	try {
		const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
		return res.ok;
	} catch {
		return false;
	}
}

export async function trellisGenerate(
	opts: {
		prompt?: string;
		imagePath?: string;
		quality?: "standard" | "high" | "ultra";
		user?: string;
	},
	base = trellisBaseUrl(),
): Promise<TrellisGenerateResponse> {
	const user = opts.user ?? trellisUser();
	const quality = opts.quality ?? "standard";

	let res: Response;
	if (opts.imagePath) {
		const { readFileSync } = await import("node:fs");
		const { basename } = await import("node:path");
		const body = new FormData();
		const bytes = readFileSync(opts.imagePath);
		body.set("image", new Blob([bytes]), basename(opts.imagePath));
		body.set("quality", quality);
		body.set("user", user);
		res = await fetch(`${base}/generate`, { method: "POST", body });
	} else {
		const prompt = opts.prompt?.trim();
		if (!prompt) throw new Error("Trellis: brak prompt (text-to-3D)");
		res = await fetch(`${base}/generate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt, quality, user }),
		});
	}

	if (!res.ok) {
		let detail = `HTTP ${res.status}`;
		try {
			const err = (await res.json()) as { error?: string };
			if (err.error) detail = err.error;
		} catch {
			/* ignore */
		}
		throw new Error(`Trellis /generate ${detail}`);
	}
	return (await res.json()) as TrellisGenerateResponse;
}

export async function trellisPollStatus(
	jobId: string,
	base = trellisBaseUrl(),
): Promise<TrellisJobStatus> {
	let lastErr: unknown;
	for (let attempt = 1; attempt <= 8; attempt++) {
		try {
			const res = await fetch(`${base}/status/${encodeURIComponent(jobId)}`, {
				signal: AbortSignal.timeout(120000),
			});
			if (!res.ok) throw new Error(`Trellis status HTTP ${res.status}`);
			return (await res.json()) as TrellisJobStatus;
		} catch (err) {
			lastErr = err;
			if (attempt < 8) {
				await new Promise((r) => setTimeout(r, 3000 * attempt));
			}
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function trellisWaitForHealthy(
	base = trellisBaseUrl(),
	maxWaitMs = 180000,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < maxWaitMs) {
		if (await trellisHealth(base)) return;
		await new Promise((r) => setTimeout(r, 5000));
	}
	throw new Error("Trellis nie wrócił po restarcie — sprawdź kontener :8004");
}

export async function trellisWaitForJob(
	jobId: string,
	opts: { pollMs?: number; timeoutMs?: number; base?: string; outId?: string } = {},
): Promise<string> {
	const pollMs = opts.pollMs ?? 3000;
	const timeoutMs = opts.timeoutMs ?? 900000;
	const base = opts.base ?? trellisBaseUrl();
	const start = Date.now();

	for (;;) {
		if (Date.now() - start >= timeoutMs) break;
		const st = await trellisPollStatus(jobId, base);
		if (st.status === "done") {
			const outId = st.id ?? st.out_id ?? opts.outId;
			let rel = st.glb_url;
			if (!rel && st.view_url) {
				rel = st.view_url.endsWith(".glb") ? st.view_url : `${st.view_url}.glb`;
			}
			if (!rel && outId) rel = `/view/${outId}.glb`;
			if (!rel) throw new Error("Trellis job done bez glb_url");
			return rel.startsWith("http") ? rel : `${base}${rel}`;
		}
		if (st.status === "error" || st.status === "cancelled") {
			throw new Error(st.error ?? st.message ?? `Trellis job ${st.status}`);
		}
		const pct = st.progress ?? 0;
		const phase = st.phase ?? st.status;
		process.stdout.write(`\r[Trellis] ${phase} ${pct}% — ${st.message ?? ""}`.padEnd(72));
		await new Promise((r) => setTimeout(r, pollMs));
	}
	throw new Error(`Trellis timeout (${timeoutMs}ms) job=${jobId}`);
}

export async function trellisDownloadGlb(url: string, destPath: string): Promise<void> {
	const { writeFileSync, mkdirSync } = await import("node:fs");
	const { dirname } = await import("node:path");
	mkdirSync(dirname(destPath), { recursive: true });
	let lastErr: Error | undefined;
	for (let attempt = 0; attempt < 8; attempt++) {
		const res = await fetch(url);
		if (res.ok) {
			const buf = Buffer.from(await res.arrayBuffer());
			writeFileSync(destPath, buf);
			return;
		}
		lastErr = new Error(`Download GLB HTTP ${res.status}`);
		await new Promise((r) => setTimeout(r, 1500));
	}
	throw lastErr ?? new Error("Download GLB failed");
}
