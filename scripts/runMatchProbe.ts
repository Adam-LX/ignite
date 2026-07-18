/**
 * Headless Match Probe — mecze bot‑vs‑bot + FINDINGS.md
 *
 *   npm run probe:matches
 *   npm run probe:matches -- --matches 2 --seconds 30 --seed 7
 */
import { runMatchProbe } from "../src/diagnostic/MatchProbeRunner";
import type { ProbeModeId } from "../src/diagnostic/matchProbeTypes";

function argVal(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	if (i < 0) return undefined;
	return process.argv[i + 1];
}

function argNum(flag: string, fallback: number): number {
	const raw = argVal(flag);
	if (raw == null) return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

const matches = argNum("--matches", 5);
const seconds = argNum("--seconds", 90);
const seed = argNum("--seed", 42);
const outDir = argVal("--out") ?? "data/match-probes";
const modeRaw = argVal("--mode") ?? "1v1";
const mode: ProbeModeId = modeRaw === "1v1" ? "1v1" : "1v1";

const report = await runMatchProbe({
	matches,
	seconds,
	seed,
	mode,
	outDir,
	writeFiles: true,
});

for (const f of report.findings) {
	console.info(`  [${f.severity}] ${f.id}: ${f.title}`);
}
if (report.findings.length === 0) {
	console.info("  (brak alertów)");
}

process.exit(0);
