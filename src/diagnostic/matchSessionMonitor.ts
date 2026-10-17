/**
 * Monitor jednej sesji meczu — timeline zdarzeń + snapshoty viewport/net/HUD.
 * Lekki: ring zdarzeń, bez ciężkiego dumpowania każdego ticka.
 */

import { matchMark } from "./matchTrace";
import { getFrameStatsSummary, resetFrameStats } from "./frameStats";

export type MatchSessionEvent = {
	tSec: number;
	kind: string;
	detail?: string;
};

export type MatchSessionSnapshot = {
	startedAt: string;
	endedAt?: string;
	mode?: string | null;
	online?: boolean;
	role?: string | null;
	roomCode?: string | null;
	ranked?: boolean;
	events: MatchSessionEvent[];
	viewportSamples: Array<{
		tSec: number;
		innerW: number;
		innerH: number;
		dpr: number;
		dbW?: number;
		dbH?: number;
		cssW?: number;
		cssH?: number;
		mismatch?: boolean;
	}>;
	phaseTimeline: Array<{ tSec: number; phase: string }>;
	scoreTimeline: Array<{ tSec: number; blue: number; orange: number }>;
	lastHud?: Record<string, unknown>;
	performance?: ReturnType<typeof getFrameStatsSummary>;
	flags: {
		sawBlackBarSuspect: boolean;
		sawFreeze: boolean;
		sawSevereHitch: boolean;
		hiddenWhilePlaying: boolean;
		resizedDuringMatch: boolean;
	};
};

const MAX_EVENTS = 80;
const MAX_VIEWPORT = 24;
const MAX_PHASE = 40;
const MAX_SCORE = 30;

let active = false;
let t0 = 0;
let snapshot: MatchSessionSnapshot | null = null;
let lastPhase = "";
let lastBlue = -1;
let lastOrange = -1;
let lastViewportSampleMs = 0;

function nowSec(): number {
	return Math.round(((performance.now() - t0) / 1000) * 100) / 100;
}

function pushEvent(kind: string, detail?: string): void {
	if (!snapshot) return;
	snapshot.events.push({ tSec: nowSec(), kind, detail });
	if (snapshot.events.length > MAX_EVENTS) {
		snapshot.events.splice(0, snapshot.events.length - MAX_EVENTS);
	}
}

function sampleViewport(force = false): void {
	if (!snapshot || typeof window === "undefined") return;
	const now = performance.now();
	if (!force && now - lastViewportSampleMs < 4000) return;
	lastViewportSampleMs = now;

	const canvas =
		document.querySelector<HTMLCanvasElement>("#game-container canvas") ||
		document.querySelector<HTMLCanvasElement>("canvas");
	const gl =
		canvas?.getContext("webgl2") || canvas?.getContext("webgl") || null;
	const dpr = window.devicePixelRatio || 1;
	const dbW = gl?.drawingBufferWidth;
	const dbH = gl?.drawingBufferHeight;
	const cssW = canvas?.clientWidth;
	const cssH = canvas?.clientHeight;
	const mismatch =
		dbW != null &&
		cssW != null &&
		Math.abs(dbW - cssW * dpr) > 2;

	if (mismatch) {
		snapshot.flags.sawBlackBarSuspect = true;
		pushEvent("viewport-mismatch", `${dbW}x${dbH} vs css ${cssW}x${cssH}@${dpr}`);
		matchMark(`viewport mismatch db=${dbW}x${dbH} css=${cssW}x${cssH}`, "render");
	}

	snapshot.viewportSamples.push({
		tSec: nowSec(),
		innerW: window.innerWidth,
		innerH: window.innerHeight,
		dpr,
		dbW,
		dbH,
		cssW,
		cssH,
		mismatch,
	});
	if (snapshot.viewportSamples.length > MAX_VIEWPORT) {
		snapshot.viewportSamples.splice(
			0,
			snapshot.viewportSamples.length - MAX_VIEWPORT,
		);
	}
}

export function beginMatchSession(meta: {
	mode?: string | null;
	online?: boolean;
	role?: string | null;
	roomCode?: string | null;
	ranked?: boolean;
}): void {
	resetFrameStats();
	t0 = performance.now();
	active = true;
	lastPhase = "";
	lastBlue = -1;
	lastOrange = -1;
	lastViewportSampleMs = 0;
	snapshot = {
		startedAt: new Date().toISOString(),
		mode: meta.mode ?? null,
		online: Boolean(meta.online),
		role: meta.role ?? null,
		roomCode: meta.roomCode ?? null,
		ranked: Boolean(meta.ranked),
		events: [],
		viewportSamples: [],
		phaseTimeline: [],
		scoreTimeline: [],
		flags: {
			sawBlackBarSuspect: false,
			sawFreeze: false,
			sawSevereHitch: false,
			hiddenWhilePlaying: false,
			resizedDuringMatch: false,
		},
	};
	pushEvent("match-start", meta.mode ?? undefined);
	sampleViewport(true);
	matchMark(
		`session monitor start mode=${meta.mode} online=${meta.online}`,
		"match",
	);
}

export function noteMatchFrame(): void {
	if (!active || !snapshot) return;
	const perf = getFrameStatsSummary();
	if (perf.freezeCount > 0) snapshot.flags.sawFreeze = true;
	if (perf.severeHitchCount > 0) snapshot.flags.sawSevereHitch = true;
	sampleViewport(false);
}

export function noteMatchHud(hud: {
	phase?: string;
	blueScore?: number;
	orangeScore?: number;
	timeRemainingSec?: number;
	extra?: Record<string, unknown>;
}): void {
	if (!active || !snapshot) return;
	const phase = hud.phase ?? "";
	if (phase && phase !== lastPhase) {
		lastPhase = phase;
		snapshot.phaseTimeline.push({ tSec: nowSec(), phase });
		if (snapshot.phaseTimeline.length > MAX_PHASE) {
			snapshot.phaseTimeline.splice(
				0,
				snapshot.phaseTimeline.length - MAX_PHASE,
			);
		}
		pushEvent("phase", phase);
	}
	const blue = hud.blueScore ?? 0;
	const orange = hud.orangeScore ?? 0;
	if (blue !== lastBlue || orange !== lastOrange) {
		lastBlue = blue;
		lastOrange = orange;
		snapshot.scoreTimeline.push({ tSec: nowSec(), blue, orange });
		if (snapshot.scoreTimeline.length > MAX_SCORE) {
			snapshot.scoreTimeline.splice(
				0,
				snapshot.scoreTimeline.length - MAX_SCORE,
			);
		}
		pushEvent("score", `${blue}:${orange}`);
	}
	snapshot.lastHud = {
		phase,
		blueScore: blue,
		orangeScore: orange,
		timeRemainingSec: hud.timeRemainingSec,
		...hud.extra,
	};
}

export function noteMatchEvent(kind: string, detail?: string): void {
	if (!active) return;
	pushEvent(kind, detail);
}

export function endMatchSession(): MatchSessionSnapshot | null {
	if (!snapshot) return null;
	sampleViewport(true);
	snapshot.endedAt = new Date().toISOString();
	snapshot.performance = getFrameStatsSummary();
	pushEvent("match-end");
	active = false;
	const out = snapshot;
	matchMark(
		`session monitor end freezes=${out.performance?.freezeCount ?? 0} hitches=${out.performance?.hitchCount ?? 0}`,
		"match",
	);
	return out;
}

export function getMatchSessionSnapshot(): MatchSessionSnapshot | null {
	if (!snapshot) return null;
	return {
		...snapshot,
		performance: getFrameStatsSummary(),
	};
}

export function installMatchSessionWindowHooks(): void {
	if (typeof window === "undefined") return;
	window.addEventListener("resize", () => {
		if (!active || !snapshot) return;
		snapshot.flags.resizedDuringMatch = true;
		pushEvent(
			"resize",
			`${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
		);
		sampleViewport(true);
	});
	document.addEventListener("visibilitychange", () => {
		if (!active || !snapshot) return;
		if (document.visibilityState === "hidden") {
			snapshot.flags.hiddenWhilePlaying = true;
			pushEvent("hidden");
		} else {
			pushEvent("visible");
		}
	});
}
