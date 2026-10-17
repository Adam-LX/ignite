/**
 * Automatyczne wysyłanie raportów gracza (throttle + triggery).
 * Domyślnie włączone; wyłącz: localStorage ignite-auto-report=0
 */

import { getErrorRing } from "./errorRing";
import {
	buildPlayerReport,
	sendPlayerReport,
	type PlayerReportPayload,
} from "./PlayerReport";

const ENABLED_KEY = "ignite-auto-report";
const LAST_SENT_KEY = "ignite-auto-report-last";
/** Min. odstęp między auto-raportami na tym kliencie. */
const MIN_INTERVAL_MS = 30 * 60_000;
/** Ile nowych błędów od ostatniego raportu zanim wyślemy „burst”. */
const ERROR_BURST = 4;
/** Debounce po crashu okna. */
const CRASH_DEBOUNCE_MS = 2500;

let lastErrorCountAtSend = 0;
let crashTimer: number | null = null;
let sending = false;
let installed = false;

export function isAutoPlayerReportEnabled(): boolean {
	try {
		const v = localStorage.getItem(ENABLED_KEY);
		if (v === "0" || v === "false") return false;
		if (v === "1" || v === "true") return true;
	} catch {
		/* ignore */
	}
	return true;
}

export function setAutoPlayerReportEnabled(on: boolean): void {
	try {
		localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
	} catch {
		/* ignore */
	}
}

function lastSentAt(): number {
	try {
		return Number(localStorage.getItem(LAST_SENT_KEY) || "0") || 0;
	} catch {
		return 0;
	}
}

function markSent(): void {
	try {
		localStorage.setItem(LAST_SENT_KEY, String(Date.now()));
	} catch {
		/* ignore */
	}
	lastErrorCountAtSend = getErrorRing().length;
}

function canSendNow(force?: boolean): boolean {
	if (!isAutoPlayerReportEnabled()) return false;
	if (sending) return false;
	if (force) return true;
	return Date.now() - lastSentAt() >= MIN_INTERVAL_MS;
}

function shouldReportPerformance(report: PlayerReportPayload): boolean {
	const p95 = report.performance.p95FrameMs;
	const max = report.performance.maxFrameMs;
	if (report.viewport.menuBloomLikely) return true;
	if ((report.performance.freezeCount ?? 0) > 0) return true;
	if ((report.performance.severeHitchCount ?? 0) >= 3) return true;
	if ((report.performance.hitchCount ?? 0) >= 12) return true;
	if (report.matchSession?.flags.sawBlackBarSuspect) return true;
	if (report.matchSession?.flags.sawFreeze) return true;
	if (p95 != null && p95 >= 40) return true;
	if (max != null && max >= 80) return true;
	return false;
}

export async function maybeAutoSendPlayerReport(opts: {
	reason: string;
	force?: boolean;
	note?: string;
	context?: Record<string, unknown>;
}): Promise<boolean> {
	if (!canSendNow(opts.force)) return false;

	const errors = getErrorRing();
	const draft = buildPlayerReport({
		note: opts.note ?? `auto: ${opts.reason}`,
		context: {
			auto: true,
			reason: opts.reason,
			...opts.context,
		},
	});

	const burst = errors.length - lastErrorCountAtSend >= ERROR_BURST;
	const interesting =
		opts.force ||
		opts.reason.startsWith("crash") ||
		burst ||
		shouldReportPerformance(draft) ||
		errors.length >= 3;

	if (!interesting && !opts.force) return false;

	sending = true;
	try {
		const result = await sendPlayerReport(draft);
		if (result.ok) {
			markSent();
			console.info(
				`[AutoReport] wysłano (${opts.reason})`,
				result.issueNumber ?? result.issueUrl,
			);
			return true;
		}
		console.warn(`[AutoReport] fail (${opts.reason}):`, result.error);
		return false;
	} finally {
		sending = false;
	}
}

function scheduleCrashReport(kind: string, detail: string): void {
	if (!isAutoPlayerReportEnabled()) return;
	if (crashTimer != null) window.clearTimeout(crashTimer);
	crashTimer = window.setTimeout(() => {
		crashTimer = null;
		void maybeAutoSendPlayerReport({
			reason: `crash:${kind}`,
			force: true,
			note: `auto crash: ${detail.slice(0, 120)}`,
			context: { kind, detail: detail.slice(0, 300) },
		});
	}, CRASH_DEBOUNCE_MS);
}

/** Wołaj po meczu / wyjściu do menu — wyśle tylko gdy są błędy lub zły viewport/FPS. */
export function autoReportAfterMatch(context?: Record<string, unknown>): void {
	void maybeAutoSendPlayerReport({
		reason: "after-match",
		note: "auto: after match",
		context,
	});
}

export function installAutoPlayerReport(): void {
	if (installed || typeof window === "undefined") return;
	installed = true;
	lastErrorCountAtSend = getErrorRing().length;

	window.addEventListener("error", (ev) => {
		scheduleCrashReport("window", ev.message || String(ev.error ?? "error"));
	});
	window.addEventListener("unhandledrejection", (ev) => {
		const r = ev.reason;
		scheduleCrashReport(
			"rejection",
			r instanceof Error ? r.message : String(r ?? "rejection"),
		);
	});

	window.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") {
			void maybeAutoSendPlayerReport({
				reason: "visibility-hidden",
				note: "auto: tab hidden",
			});
		}
	});
}
