/**
 * Prematch / kickoff hitch probe — taguje fazy i zbiera long frames.
 *
 * Użycie:
 * - `?hitchProbe=1` lub localStorage `ignite-hitch-probe=1` → logi + dump na window
 * - Cloud agent / NixBot: czytaj `docs/PREMATCH_KICKOFF_FREEZE.md`
 *
 * Thresholds (aligned with frameStats): hitch≥50ms, severe≥100ms, freeze≥250ms.
 */
import { noteFrameTime, getFrameStatsSummary } from "./frameStats";

export type HitchPhase =
	| "show_construct"
	| "show_run"
	| "show_cue_build"
	| "show_cue_liquid"
	| "show_cue_drop"
	| "show_cue_rain"
	| "show_teardown"
	| "show_dispose"
	| "post_show_snap"
	| "countdown_prime"
	| "countdown"
	| "kickoff_go"
	| "unknown";

type HitchEvent = {
	ms: number;
	phase: HitchPhase;
	showU: number | null;
	wallMs: number;
	note?: string;
};

const HITCH_MS = 50;
const SEVERE_MS = 100;
const FREEZE_MS = 250;
const MAX_EVENTS = 64;

let enabled = false;
let phase: HitchPhase = "unknown";
let showU: number | null = null;
let lastTick = 0;
let events: HitchEvent[] = [];
let phaseStartedAt = 0;

function readEnabled(): boolean {
	try {
		if (typeof location !== "undefined") {
			const q = new URLSearchParams(location.search);
			if (q.get("hitchProbe") === "1" || q.get("hitchDiag") === "1") return true;
		}
		const v = localStorage.getItem("ignite-hitch-probe");
		if (v === "1" || v === "true") return true;
	} catch {
		/* ignore */
	}
	/** Domyślnie ON w DEV — freezy prematch są aktywnym bugiem. */
	return import.meta.env.DEV;
}

export function isPrematchHitchProbeEnabled(): boolean {
	return enabled;
}

function mirrorDumpToWindow(): void {
	try {
		const w = window as unknown as {
			__ignitePrematchHitch?: ReturnType<typeof getPrematchHitchDump>;
			__igniteGetPrematchHitch?: typeof getPrematchHitchDump;
		};
		w.__igniteGetPrematchHitch = getPrematchHitchDump;
		w.__ignitePrematchHitch = getPrematchHitchDump();
	} catch {
		/* ignore */
	}
}

export function beginPrematchHitchProbe(): void {
	enabled = readEnabled();
	events = [];
	lastTick = 0;
	phase = "show_construct";
	showU = 0;
	phaseStartedAt = performance.now();
	if (enabled) {
		console.info(
			"[hitchProbe] ON — thresholds hitch≥50 severe≥100 freeze≥250. Dump: window.__ignitePrematchHitch",
		);
		mirrorDumpToWindow();
	}
}

export function setPrematchHitchPhase(
	next: HitchPhase,
	note?: string,
): void {
	if (!enabled && !readEnabled()) return;
	enabled = true;
	const now = performance.now();
	if (phase !== next) {
		const spent = now - phaseStartedAt;
		if (enabled && spent > 16) {
			console.info(
				`[hitchProbe] phase ${phase} → ${next} (spent ${spent.toFixed(0)}ms)${note ? ` ${note}` : ""}`,
			);
		}
		phase = next;
		phaseStartedAt = now;
	} else if (note) {
		console.info(`[hitchProbe] ${phase}: ${note}`);
	}
}

export function setPrematchHitchShowU(u: number): void {
	showU = u;
	if (u < 0.12) setPrematchHitchPhase("show_run");
	else if (u < 0.32) setPrematchHitchPhase("show_cue_build");
	else if (u < 0.5) setPrematchHitchPhase("show_cue_liquid");
	else if (u < 0.7) setPrematchHitchPhase("show_cue_drop");
	else if (u < 0.95) setPrematchHitchPhase("show_cue_rain");
}

/**
 * Wołaj raz na klatkę pętli show (i opcjonalnie tuż po kickoffie).
 * Syncuje też globalne frameStats.
 */
export function resetPrematchHitchTickClock(): void {
	lastTick = 0;
}

export function notePrematchHitchTick(nowMs = performance.now()): void {
	noteFrameTime(nowMs);
	if (!enabled) {
		enabled = readEnabled();
		if (!enabled) {
			lastTick = nowMs;
			return;
		}
	}
	if (lastTick > 0) {
		const dt = nowMs - lastTick;
		if (dt >= HITCH_MS && dt < 8000) {
			const ev: HitchEvent = {
				ms: Math.round(dt * 10) / 10,
				phase,
				showU: showU == null ? null : Math.round(showU * 1000) / 1000,
				wallMs: Math.round(nowMs),
			};
			events.push(ev);
			if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
			const tier =
				dt >= FREEZE_MS ? "FREEZE" : dt >= SEVERE_MS ? "SEVERE" : "hitch";
			console.warn(
				`[hitchProbe] ${tier} ${ev.ms}ms phase=${ev.phase} showU=${ev.showU}`,
			);
			mirrorDumpToWindow();
		}
	}
	lastTick = nowMs;
}

export function markPrematchHitchSpan(label: string, startMs: number): void {
	const dt = performance.now() - startMs;
	if (!enabled && dt < HITCH_MS) return;
	enabled = enabled || readEnabled();
	if (dt >= HITCH_MS) {
		events.push({
			ms: Math.round(dt * 10) / 10,
			phase,
			showU,
			wallMs: Math.round(performance.now()),
			note: label,
		});
		console.warn(
			`[hitchProbe] SPAN ${label} ${dt.toFixed(1)}ms phase=${phase}`,
		);
	}
}

export type PrematchHitchDump = {
	enabled: boolean;
	phase: HitchPhase;
	events: HitchEvent[];
	byPhase: Record<string, { count: number; maxMs: number; sumMs: number }>;
	frameStats: ReturnType<typeof getFrameStatsSummary>;
	suspects: string[];
};

export function getPrematchHitchDump(): PrematchHitchDump {
	const byPhase: PrematchHitchDump["byPhase"] = {};
	for (const e of events) {
		const key = e.note ? `${e.phase}:${e.note}` : e.phase;
		const slot = (byPhase[key] ??= { count: 0, maxMs: 0, sumMs: 0 });
		slot.count++;
		slot.maxMs = Math.max(slot.maxMs, e.ms);
		slot.sumMs += e.ms;
	}
	const suspects: string[] = [];
	const drop = byPhase["show_cue_drop"];
	if (drop && drop.maxMs >= SEVERE_MS) {
		suspects.push(
			"DROP cue: pyro/smoke/flash/scanner punch — sprawdź StadiumShowPyro + scanners + fireFlash",
		);
	}
	if ((byPhase["show_dispose"]?.maxMs ?? 0) >= HITCH_MS) {
		suspects.push(
			"dispose: synchroniczne ShaderMaterial.dispose — beginTeardown/yieldFrames",
		);
	}
	if ((byPhase["countdown_prime"]?.maxMs ?? 0) >= HITCH_MS) {
		suspects.push(
			"primeArenaVisuals: BoostPadVfx / IgnitionZoneVfx / jumbotron YT mount",
		);
	}
	if ((byPhase["show_construct"]?.maxMs ?? 0) >= SEVERE_MS) {
		suspects.push(
			"construct: StadiumLaserRig + smoke textures + scanners alloc",
		);
	}
	const fs = getFrameStatsSummary();
	if (fs.freezeCount > 0) {
		suspects.push(
			`frameStats freezeCount=${fs.freezeCount} longest=${fs.longestFrameMs}ms`,
		);
	}
	return {
		enabled,
		phase,
		events: [...events],
		byPhase,
		frameStats: fs,
		suspects,
	};
}

export function endPrematchHitchProbe(tag = "end"): PrematchHitchDump {
	const dump = getPrematchHitchDump();
	try {
		(
			window as unknown as { __ignitePrematchHitch?: PrematchHitchDump }
		).__ignitePrematchHitch = dump;
	} catch {
		/* ignore */
	}
	if (enabled || dump.events.length > 0) {
		console.info(
			`[hitchProbe] ${tag} events=${dump.events.length} freezes=${dump.frameStats.freezeCount} severe=${dump.frameStats.severeHitchCount}`,
			dump.byPhase,
			dump.suspects,
		);
	}
	return dump;
}
