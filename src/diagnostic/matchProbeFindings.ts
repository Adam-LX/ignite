import type {
	MatchProbeAggregate,
	ProbeFinding,
} from "./matchProbeTypes";

/** Reguły wniosków z agregatu Match Probe (testowalne bez Rapier). */
export function deriveMatchProbeFindings(
	agg: MatchProbeAggregate,
): ProbeFinding[] {
	const out: ProbeFinding[] = [];

	if (agg.kickoffContactOver4sRate >= 0.4) {
		out.push({
			id: "kickoff_slow_contact",
			severity: agg.kickoffContactOver4sRate >= 0.6 ? "crit" : "warn",
			title: "Wolny kontakt na kickoffie",
			detail: `${Math.round(agg.kickoffContactOver4sRate * 100)}% meczów ma first-touch > 4 s (średnia ${fmt(agg.avgKickoffFirstContactSec)} s).`,
			hintFiles: [
				"src/ai/BotBehavior.ts",
				"src/game/rlKickoffSpawns.ts",
				"src/physics/RocketCar.ts",
			],
		});
	}

	if (agg.kickoffDiagonalFailRate > 0) {
		out.push({
			id: "kickoff_not_diagonal",
			severity: "crit",
			title: "Kickoff nie jest diagonalny",
			detail: `${Math.round(agg.kickoffDiagonalFailRate * 100)}% spawnów ma ten sam znak X (blue/orange).`,
			hintFiles: ["src/game/rlKickoffSpawns.ts"],
		});
	}

	if (agg.passiveRegenSuspect) {
		out.push({
			id: "passive_regen_leak",
			severity: "crit",
			title: "Podejrzenie passive boost regen w Core",
			detail:
				"Zaobserwowano przyrost fuel bez pickupów padów — Core powinien mieć mul=1 → zero regen.",
			hintFiles: ["src/physics/RocketCar.ts", "src/util/rlConstants.ts"],
		});
	}

	if (agg.recoveryFailRate >= 0.25) {
		out.push({
			id: "recovery_fail_high",
			severity: agg.recoveryFailRate >= 0.4 ? "crit" : "warn",
			title: "Wysoki fail rate recovery",
			detail: `${Math.round(agg.recoveryFailRate * 100)}% epizodów recovery nie wraca na koła w limicie.`,
			hintFiles: ["src/ai/botRecovery.ts", "src/ai/BotBehavior.ts"],
		});
	}

	if (agg.avgBoostFuel < 0.15 && agg.avgPadSeeks < 0.5 && agg.avgPadPickups > 0) {
		out.push({
			id: "pad_seek_starved",
			severity: "warn",
			title: "Niski boost bez pad seek",
			detail: `Śr. fuel ${fmt(agg.avgBoostFuel)}, pad seeks ${fmt(agg.avgPadSeeks)} — boty nie zbierają padów.`,
			hintFiles: [
				"src/ai/botTactics.ts",
				"src/ai/BotBehavior.ts",
				"src/diagnostic/MatchProbeRunner.ts",
			],
		});
	}

	if (agg.avgBoostWasteSec >= 2.5) {
		out.push({
			id: "boost_waste_high",
			severity: "warn",
			title: "Wysoki boost waste",
			detail: `Śr. ${fmt(agg.avgBoostWasteSec)} s waste / mecz (boost przy max speed daleko od piłki).`,
			hintFiles: ["src/ai/BotBehavior.ts"],
		});
	}

	if (agg.avgWhiffs >= 4) {
		out.push({
			id: "whiff_high",
			severity: "warn",
			title: "Dużo whiffów",
			detail: `Śr. ${fmt(agg.avgWhiffs)} whiffów / mecz.`,
			hintFiles: ["src/ai/BotBehavior.ts", "src/ai/botTactics.ts"],
		});
	}

	if (agg.nearMissDeadHitRate >= 2) {
		out.push({
			id: "dead_hits_high",
			severity: "warn",
			title: "Martwe kontakty blisko piłki",
			detail: `Śr. ${fmt(agg.nearMissDeadHitRate)} epizodów orbitowania (≥0.85 s bez hitu) / mecz.`,
			hintFiles: ["src/ai/BotBehavior.ts", "src/util/rlContacts.ts"],
		});
	}

	if (agg.avgBallTouches < 3 && agg.secondsPerMatch >= 30) {
		out.push({
			id: "low_engagement",
			severity: "info",
			title: "Niska liczba kontaktów z piłką",
			detail: `Śr. ${fmt(agg.avgBallTouches)} touches przy ${agg.secondsPerMatch} s — boty mogą nie gonić.`,
			hintFiles: ["src/ai/BotBehavior.ts", "src/ai/AIManager.ts"],
		});
	}

	if (agg.avgWallSec < 0.4 && agg.secondsPerMatch >= 45) {
		out.push({
			id: "wall_ride_absent",
			severity: "info",
			title: "Boty prawie nie jeżdżą po bandach",
			detail: `Śr. ${fmt(agg.avgWallSec)} s na ścianie / auto (sufit ${fmt(agg.avgCeilingSec)} s) — wall avoidance może blokować wall-ride.`,
			hintFiles: [
				"src/ai/BotBehavior.ts",
				"src/physics/RocketCar.ts",
				"scripts/runWallCeilingAudit.ts",
			],
		});
	}

	const goalsPerMatch = agg.avgBlueGoals + agg.avgOrangeGoals;
	if (
		goalsPerMatch < 0.25 &&
		agg.avgBallTouches >= 20 &&
		agg.secondsPerMatch >= 45
	) {
		out.push({
			id: "zero_scoring",
			severity: goalsPerMatch < 0.05 ? "crit" : "warn",
			title: "Brak / bardzo mało goli przy aktywnej grze",
			detail: `Śr. ${fmt(goalsPerMatch)} goli / mecz przy ${fmt(agg.avgBallTouches)} touchach — podejście / strzał (shadow, dodge) wymaga poprawy.`,
			hintFiles: [
				"src/ai/botTactics.ts",
				"src/ai/BotBehavior.ts",
			],
		});
	}

	return out;
}

export function formatFindingsMarkdown(
	findings: ProbeFinding[],
	agg: MatchProbeAggregate,
): string {
	const lines: string[] = [
		`# Match Probe — FINDINGS`,
		``,
		`Wygenerowano z ${agg.matchCount} meczów × ${agg.secondsPerMatch} s (${agg.mode}).`,
		``,
		`## Agregat`,
		``,
		`- Gole blue/orange: ${fmt(agg.avgBlueGoals)} / ${fmt(agg.avgOrangeGoals)}`,
		`- Ball touches: ${fmt(agg.avgBallTouches)}`,
		`- Kickoff first contact: ${fmt(agg.avgKickoffFirstContactSec)} s`,
		`- Kickoff >4 s rate: ${pct(agg.kickoffContactOver4sRate)}`,
		`- Avg boost fuel: ${fmt(agg.avgBoostFuel)}`,
		`- Pad seeks / pickups: ${fmt(agg.avgPadSeeks)} / ${fmt(agg.avgPadPickups)}`,
		`- Recovery fail: ${pct(agg.recoveryFailRate)}`,
		`- Whiffs: ${fmt(agg.avgWhiffs)} · boost waste: ${fmt(agg.avgBoostWasteSec)} s`,
		`- Wall / ceiling sec (śr./auto): ${fmt(agg.avgWallSec)} / ${fmt(agg.avgCeilingSec)}`,
		``,
		`## Wnioski`,
		``,
	];

	if (findings.length === 0) {
		lines.push(`_Brak alertów — metryki w normie._`, ``);
	} else {
		for (const f of findings) {
			lines.push(
				`### [${f.severity.toUpperCase()}] ${f.title}`,
				``,
				f.detail,
				``,
				`Hint: ${f.hintFiles.map((p) => `\`${p}\``).join(", ")}`,
				``,
			);
		}
	}

	lines.push(
		`## Następny krok`,
		``,
		`Agent czyta ten plik + JSON i proponuje patche. Po akceptacji: re-probe \`--matches 2\`.`,
		``,
	);
	return lines.join("\n");
}

function fmt(n: number | null): string {
	if (n == null || Number.isNaN(n)) return "—";
	return (Math.round(n * 100) / 100).toString();
}

function pct(n: number): string {
	return `${Math.round(n * 100)}%`;
}
