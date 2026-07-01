/** Historia postępu botów — localStorage + federacja + podsumowanie dla UI / CLI. */

import type { FederatedProgressEntry } from "../../net/botPolicyProtocol";
import { computeBotIQ, iqFromProgressEntry } from "./BotIQ";
import { computePolicyMaturity } from "./BotJumpResolver";

export type BotProgressEntry = {
	ts: number;
	generation: number;
	fitness: number;
	bestFitness: number;
	botDelta: number;
	aerialTouches: number;
	microEvolved: boolean;
	source: "match" | "micro";
	/** Złożony wskaźnik UI (78–165), zapisywany przy każdym wpisie. */
	iq?: number;
};

export type BotProgressSummary = {
	entries: number;
	generation: number;
	fitness: number;
	bestFitness: number;
	globalMatches: number;
	/** Wpisy z federacji (ostatni fetch). */
	federatedEntries: number;
	totalAerialTouches: number;
	microPromotions: number;
	fitnessTrend: number;
	aerialTrend: number;
	iq: number;
	iqTrend: number;
	/** Ułamek ostatnich meczów z botDelta > 0. */
	winRateRecent: number;
	recentBotDeltaAvg: number;
	sparkline: number[];
	iqSparkline: number[];
	deltaSparkline: number[];
	lastEntry: BotProgressEntry | null;
};

const PROGRESS_KEY = "ignite-bot-progress-log";
const MAX_ENTRIES = 96;
const DEDUPE_MS = 4000;

export function federatedEntryToProgressEntry(
	e: FederatedProgressEntry,
	bestFitness: number,
): BotProgressEntry {
	return {
		ts: Date.parse(e.ts) || Date.now(),
		generation: e.generation,
		fitness: e.fitness,
		bestFitness,
		botDelta: e.botDelta,
		aerialTouches: e.aerialTouches,
		microEvolved: false,
		source: "match",
	};
}

/** Scala log federacyjny z lokalnym (bez duplikatów tego samego meczu). */
export function mergeProgressLogsForReport(
	federated: FederatedProgressEntry[],
	local: BotProgressEntry[],
	bestFitness: number,
): BotProgressEntry[] {
	const fed = federated.map((e) =>
		federatedEntryToProgressEntry(e, bestFitness),
	);
	const merged = [...fed];
	for (const loc of local) {
		const dup = fed.some(
			(f) =>
				f.generation === loc.generation &&
				Math.abs(f.ts - loc.ts) < DEDUPE_MS &&
				Math.abs(f.botDelta - loc.botDelta) < 0.05,
		);
		if (!dup) merged.push(loc);
	}
	merged.sort((a, b) => a.ts - b.ts);
	while (merged.length > MAX_ENTRIES) merged.shift();
	return merged;
}

function avgEntry(
	arr: BotProgressEntry[],
	key: keyof BotProgressEntry,
): number {
	if (arr.length === 0) return 0;
	let sum = 0;
	for (const e of arr) {
		const v = e[key];
		sum += typeof v === "number" ? v : 0;
	}
	return sum / arr.length;
}

export function buildProgressIQSnapshot(
	log: BotProgressEntry[],
	opts: {
		generation: number;
		fitness: number;
		bestFitness: number;
	},
): number {
	const matchEntries = log.filter((e) => e.source === "match");
	const recentMatches = matchEntries.slice(-12);
	const recentBotDeltaAvg = avgEntry(recentMatches, "botDelta");
	const aerialPerMatch =
		matchEntries.length > 0
			? log.reduce((s, e) => s + e.aerialTouches, 0) / matchEntries.length
			: 0;
	const microPromotions = log.filter((e) => e.microEvolved).length;
	const maturity = computePolicyMaturity(opts.generation, opts.fitness, true);

	return computeBotIQ({
		generation: opts.generation,
		fitness: opts.fitness,
		bestFitness: opts.bestFitness,
		recentBotDeltaAvg,
		aerialPerMatch,
		microPromotions,
		maturity,
	});
}

export function recordBotProgress(entry: BotProgressEntry): void {
	try {
		const log = getBotProgressLog();
		const withIq: BotProgressEntry = {
			...entry,
			iq:
				entry.iq ??
				iqFromProgressEntry({
					...entry,
					iq: undefined,
				}),
		};
		log.push(withIq);
		while (log.length > MAX_ENTRIES) log.shift();
		localStorage.setItem(PROGRESS_KEY, JSON.stringify(log));
	} catch {
		// ignore quota / private mode
	}
}

export function getBotProgressLog(): BotProgressEntry[] {
	try {
		const raw = localStorage.getItem(PROGRESS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as BotProgressEntry[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function clearBotProgressLog(): void {
	try {
		localStorage.removeItem(PROGRESS_KEY);
	} catch {
		// ignore
	}
}

export function summarizeBotProgress(
	log: BotProgressEntry[],
	opts?: {
		generation?: number;
		fitness?: number;
		bestFitness?: number;
		globalMatches?: number;
		federatedEntries?: number;
	},
): BotProgressSummary {
	const entries = log.length;
	const lastEntry = entries > 0 ? log[entries - 1]! : null;
	const matchEntries = log.filter((e) => e.source === "match");
	const recent = matchEntries.slice(-8);
	const prior = matchEntries.slice(-16, -8);
	const recentForm = matchEntries.slice(-12);

	const generation = opts?.generation ?? lastEntry?.generation ?? 0;
	const fitness = opts?.fitness ?? lastEntry?.fitness ?? 0;
	const bestFitness = opts?.bestFitness ?? lastEntry?.bestFitness ?? 0;

	const fitnessTrend = avgEntry(recent, "fitness") - avgEntry(prior, "fitness");
	const aerialTrend =
		avgEntry(recent, "aerialTouches") - avgEntry(prior, "aerialTouches");

	const iqRecent = recent.map((e) => iqFromProgressEntry(e));
	const iqPrior = prior.map((e) => iqFromProgressEntry(e));
	const iqTrend =
		(iqRecent.length > 0
			? iqRecent.reduce((s, v) => s + v, 0) / iqRecent.length
			: 0) -
		(iqPrior.length > 0
			? iqPrior.reduce((s, v) => s + v, 0) / iqPrior.length
			: 0);

	const recentBotDeltaAvg = avgEntry(recentForm, "botDelta");
	const wins = recentForm.filter((e) => e.botDelta > 0.05).length;
	const winRateRecent = recentForm.length > 0 ? wins / recentForm.length : 0;

	const iq = buildProgressIQSnapshot(log, {
		generation,
		fitness,
		bestFitness,
	});

	return {
		entries,
		generation,
		fitness,
		bestFitness,
		globalMatches: opts?.globalMatches ?? 0,
		federatedEntries: opts?.federatedEntries ?? 0,
		totalAerialTouches: log.reduce((s, e) => s + e.aerialTouches, 0),
		microPromotions: log.filter((e) => e.microEvolved).length,
		fitnessTrend,
		aerialTrend,
		iq,
		iqTrend,
		winRateRecent,
		recentBotDeltaAvg,
		sparkline: matchEntries.slice(-24).map((e) => e.fitness),
		iqSparkline: matchEntries.slice(-24).map((e) => iqFromProgressEntry(e)),
		deltaSparkline: matchEntries.slice(-24).map((e) => e.botDelta),
		lastEntry,
	};
}

export function formatTrend(delta: number, digits = 1): string {
	if (Math.abs(delta) < 0.05) return "→0";
	const sign = delta > 0 ? "↑" : "↓";
	return `${sign}${Math.abs(delta).toFixed(digits)}`;
}
