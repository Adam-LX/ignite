import { getBootLog } from "./bootTrace";
import { getErrorRing } from "./errorRing";
import { getFrameStatsSummary } from "./frameStats";
import {
	getMatchSessionSnapshot,
	type MatchSessionSnapshot,
} from "./matchSessionMonitor";
import { getMatchLog } from "./matchTrace";
import { GAME_VERSION } from "../util/gameVersion";
import { resolveGraphicsSettings } from "../util/graphicsProfile";
import { mpHttpBaseUrl } from "../net/protocol";
import { resolveMpServerAddress } from "../net/serverStatus";

export type PlayerReportPayload = {
	schemaVersion: 2;
	createdAt: string;
	gameVersion: string;
	note?: string;
	platform: {
		userAgent: string;
		language: string;
		platform: string;
		hardwareConcurrency?: number;
		deviceMemoryGb?: number;
		electron?: boolean;
	};
	viewport: {
		innerWidth: number;
		innerHeight: number;
		devicePixelRatio: number;
		screenWidth: number;
		screenHeight: number;
		drawingBufferWidth?: number;
		drawingBufferHeight?: number;
		canvasCssWidth?: number;
		canvasCssHeight?: number;
		menuBloomLikely?: boolean;
	};
	graphics: ReturnType<typeof resolveGraphicsSettings>;
	webgl?: {
		vendor?: string;
		renderer?: string;
	};
	performance: ReturnType<typeof getFrameStatsSummary>;
	matchSession?: MatchSessionSnapshot | null;
	bootLog: string;
	matchLog: string;
	errors: string[];
	context?: Record<string, unknown>;
};

function readWebGlInfo(): PlayerReportPayload["webgl"] {
	try {
		const canvas = document.createElement("canvas");
		const gl =
			canvas.getContext("webgl2") || canvas.getContext("webgl");
		if (!gl) return undefined;
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		return {
			vendor: ext
				? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? "")
				: undefined,
			renderer: ext
				? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "")
				: String(gl.getParameter(gl.RENDERER) ?? ""),
		};
	} catch {
		return undefined;
	}
}

function readCanvasMetrics(): Pick<
	PlayerReportPayload["viewport"],
	| "drawingBufferWidth"
	| "drawingBufferHeight"
	| "canvasCssWidth"
	| "canvasCssHeight"
> {
	const canvas =
		document.querySelector<HTMLCanvasElement>("#game-container canvas") ||
		document.querySelector<HTMLCanvasElement>("canvas");
	if (!canvas) return {};
	const gl =
		canvas.getContext("webgl2") ||
		canvas.getContext("webgl") ||
		null;
	return {
		drawingBufferWidth: gl?.drawingBufferWidth,
		drawingBufferHeight: gl?.drawingBufferHeight,
		canvasCssWidth: canvas.clientWidth,
		canvasCssHeight: canvas.clientHeight,
	};
}

export function buildPlayerReport(opts?: {
	note?: string;
	context?: Record<string, unknown>;
}): PlayerReportPayload {
	const nav = navigator as Navigator & { deviceMemory?: number };
	const canvas = readCanvasMetrics();
	const dpr = window.devicePixelRatio || 1;
	const mismatch =
		canvas.drawingBufferWidth != null &&
		canvas.canvasCssWidth != null &&
		Math.abs(canvas.drawingBufferWidth - canvas.canvasCssWidth * dpr) > 2;

	return {
		schemaVersion: 2,
		createdAt: new Date().toISOString(),
		gameVersion: GAME_VERSION,
		note: opts?.note?.trim().slice(0, 500) || undefined,
		platform: {
			userAgent: navigator.userAgent,
			language: navigator.language,
			platform: navigator.platform,
			hardwareConcurrency: navigator.hardwareConcurrency,
			deviceMemoryGb: nav.deviceMemory,
			electron: Boolean(
				(window as unknown as { igniteDesktop?: unknown }).igniteDesktop,
			),
		},
		viewport: {
			innerWidth: window.innerWidth,
			innerHeight: window.innerHeight,
			devicePixelRatio: dpr,
			screenWidth: window.screen?.width ?? 0,
			screenHeight: window.screen?.height ?? 0,
			...canvas,
			menuBloomLikely: mismatch,
		},
		graphics: resolveGraphicsSettings(),
		webgl: readWebGlInfo(),
		performance: getFrameStatsSummary(),
		matchSession: getMatchSessionSnapshot(),
		bootLog: getBootLog(),
		matchLog: getMatchLog(),
		errors: getErrorRing(),
		context: opts?.context,
	};
}

const LAST_REPORT_KEY = "ignite-last-player-report";

export function saveReportLocally(report: PlayerReportPayload): void {
	try {
		localStorage.setItem(LAST_REPORT_KEY, JSON.stringify(report));
	} catch {
		/* ignore */
	}
}

export async function copyReportToClipboard(
	report: PlayerReportPayload,
): Promise<boolean> {
	const text = JSON.stringify(report, null, 2);
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		try {
			const ta = document.createElement("textarea");
			ta.value = text;
			ta.style.position = "fixed";
			ta.style.left = "-9999px";
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand("copy");
			ta.remove();
			return ok;
		} catch {
			return false;
		}
	}
}

export type SendPlayerReportResult =
	| { ok: true; issueUrl?: string; issueNumber?: number }
	| { ok: false; error: string; savedLocally: true };

export async function sendPlayerReport(
	report: PlayerReportPayload,
): Promise<SendPlayerReportResult> {
	saveReportLocally(report);
	try {
		const serverRaw = await resolveMpServerAddress();
		const base = mpHttpBaseUrl(serverRaw);
		const res = await fetch(`${base}/api/player-report`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(report),
		});
		const data = (await res.json().catch(() => ({}))) as {
			ok?: boolean;
			error?: string;
			issueUrl?: string;
			issueNumber?: number;
		};
		if (!res.ok || !data.ok) {
			return {
				ok: false,
				error: data.error || `HTTP ${res.status}`,
				savedLocally: true,
			};
		}
		return {
			ok: true,
			issueUrl: data.issueUrl,
			issueNumber: data.issueNumber,
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			savedLocally: true,
		};
	}
}

export async function collectAndSendPlayerReport(opts?: {
	note?: string;
	context?: Record<string, unknown>;
}): Promise<SendPlayerReportResult & { report: PlayerReportPayload }> {
	const report = buildPlayerReport(opts);
	const result = await sendPlayerReport(report);
	return { ...result, report };
}
