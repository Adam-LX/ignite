import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	formatTrend,
	summarizeBotProgress,
	type BotProgressEntry,
} from "../src/ai/learning/BotLearningProgress.ts";

const POLICY_CACHE = resolve(process.cwd(), ".bot-progress-export.json");

function loadFromArgv(): BotProgressEntry[] {
	const arg = process.argv[2];
	if (arg) {
		const raw = readFileSync(arg, "utf8");
		return JSON.parse(raw) as BotProgressEntry[];
	}
	try {
		const raw = readFileSync(POLICY_CACHE, "utf8");
		return JSON.parse(raw) as BotProgressEntry[];
	} catch {
		console.info(
			"[bot:progress] Brak pliku — w grze otwórz panel botów (B) lub podaj ścieżkę JSON z localStorage key ignite-bot-progress-log",
		);
		return [];
	}
}

const log = loadFromArgv();
const summary = summarizeBotProgress(log);

console.info("=== Ignite — raport uczenia botów ===");
console.info(
	`IQ ${summary.iq} (${formatTrend(summary.iqTrend, 0)}) · Gen ${summary.generation} · fit ${summary.fitness.toFixed(2)} · best ${summary.bestFitness.toFixed(2)}`,
);
console.info(
	`Mecze: ${summary.entries} · wygrane (ostatnie): ${Math.round(summary.winRateRecent * 100)}% · forma Δ ${summary.recentBotDeltaAvg >= 0 ? "+" : ""}${summary.recentBotDeltaAvg.toFixed(2)}`,
);
console.info(
	`Aerial Σ ${summary.totalAerialTouches} · micro+ ${summary.microPromotions}`,
);
console.info(
	`Trend: IQ ${formatTrend(summary.iqTrend, 0)} · fitness ${formatTrend(summary.fitnessTrend)} · aerial ${formatTrend(summary.aerialTrend, 2)}`,
);

if (log.length === 0) {
	process.exit(0);
}

console.info("\nOstatnie 12 wpisów:");
for (const e of log.slice(-12)) {
	const d = new Date(e.ts).toISOString().slice(0, 16).replace("T", " ");
	const tag = e.microEvolved ? "micro" : "match";
	console.info(
		`  ${d}  ${tag.padEnd(5)}  G${String(e.generation).padStart(3)}  IQ ${String(e.iq ?? "—").padStart(3)}  fit ${e.fitness.toFixed(1).padStart(6)}  Δ${e.botDelta >= 0 ? "+" : ""}${e.botDelta.toFixed(1)}  aerial ${e.aerialTouches}`,
	);
}
