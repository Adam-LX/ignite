/**
 * Headless Match Probe — mecze bot‑vs‑bot + FINDINGS.md
 *
 *   npm run probe:matches
 *   npm run probe:matches -- --matches 2 --seconds 30 --seed 7
 *   npm run probe:matches -- --mode ignitionRush2v2
 *   npm run probe:matches -- --all-modes --matches 1 --seconds 25
 */
import { allGameModes, parseGameMode } from "../src/game/modes";
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

function hasFlag(flag: string): boolean {
	return process.argv.includes(flag);
}

const matches = argNum("--matches", 5);
const seconds = argNum("--seconds", 90);
const seed = argNum("--seed", 42);
const outDir = argVal("--out") ?? "data/match-probes";
const allModes = hasFlag("--all-modes");

const modes: ProbeModeId[] = allModes
	? (allGameModes() as ProbeModeId[])
	: [parseGameMode(argVal("--mode") ?? "1v1") as ProbeModeId];

let exitCode = 0;
for (const mode of modes) {
	const modeOut = allModes ? `${outDir}/${mode}` : outDir;
	console.info(`[match-probe] mode=${mode} matches=${matches} sec=${seconds}`);
	try {
		const report = await runMatchProbe({
			matches,
			seconds,
			seed,
			mode,
			outDir: modeOut,
			writeFiles: true,
		});
		for (const f of report.findings) {
			console.info(`  [${f.severity}] ${f.id}: ${f.title}`);
		}
		if (report.findings.length === 0) {
			console.info("  (brak alertów)");
		}
	} catch (err) {
		exitCode = 1;
		console.error(`[match-probe] FAIL ${mode}:`, err);
	}
}

process.exit(exitCode);
