import { computePolicyMaturity } from "./BotJumpResolver";
import type { BotProgressEntry } from "./BotLearningProgress";

/** Środek skali — świeży bot ~100, dojrzały dobry ~120–135. */
export const BOT_IQ_BASE = 100;
export const BOT_IQ_MIN = 78;
export const BOT_IQ_MAX = 165;

export type BotIQInputs = {
	generation: number;
	fitness: number;
	bestFitness: number;
	/** Średni wynik botów w ostatnich meczach (−3…+4 typowo). */
	recentBotDeltaAvg: number;
	/** Dotknięcia aerial na mecz. */
	aerialPerMatch: number;
	microPromotions: number;
	/** Dojrzałość polityki 0..1. */
	maturity: number;
};

function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}

/**
 * Złożony „IQ” bota — czytelna skala dla UI, nie psychometryka :)
 * Składniki: fitness, best, generacja, forma (botDelta), aerial, micro-evolve.
 */
export function computeBotIQ(inputs: BotIQInputs): number {
	const fitnessNorm = clamp(inputs.fitness, -6, 14) / 14;
	const bestNorm = clamp(inputs.bestFitness, 0, 14) / 14;
	const expNorm = clamp(inputs.generation, 0, 72) / 72;
	const formNorm = clamp((inputs.recentBotDeltaAvg + 2) / 6, 0, 1);
	const aerialNorm = clamp(inputs.aerialPerMatch, 0, 3.5) / 3.5;
	const microNorm = clamp(inputs.microPromotions, 0, 36) / 36;

	const score =
		BOT_IQ_BASE +
		fitnessNorm * 14 +
		bestNorm * 6 +
		expNorm * 12 +
		formNorm * 18 +
		aerialNorm * 9 +
		microNorm * 4 +
		inputs.maturity * 8;

	return Math.round(clamp(score, BOT_IQ_MIN, BOT_IQ_MAX));
}

export function iqFromProgressEntry(entry: BotProgressEntry): number {
	if (entry.iq !== undefined && Number.isFinite(entry.iq)) {
		return entry.iq;
	}
	const maturity = computePolicyMaturity(entry.generation, entry.fitness, true);
	return computeBotIQ({
		generation: entry.generation,
		fitness: entry.fitness,
		bestFitness: entry.bestFitness,
		recentBotDeltaAvg: entry.botDelta,
		aerialPerMatch: entry.aerialTouches,
		microPromotions: entry.microEvolved ? 1 : 0,
		maturity,
	});
}

/** 0..1 do wskaźnika okrężnego w menu. */
export function iqToGaugeFill(iq: number): number {
	return clamp((iq - BOT_IQ_MIN) / (BOT_IQ_MAX - BOT_IQ_MIN), 0, 1);
}

export type BotIQTier = "rookie" | "trained" | "sharp" | "elite";

export function iqLabelTier(iq: number): BotIQTier {
	if (iq >= 138) return "elite";
	if (iq >= 118) return "sharp";
	if (iq >= 102) return "trained";
	return "rookie";
}
