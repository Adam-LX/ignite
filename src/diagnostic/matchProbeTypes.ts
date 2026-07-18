/** Typy Match Probe — headless diagnostyka mechaniki + botów. */

export type ProbeModeId = "1v1";

export type ProbeFsmKey = "ALIGN_SHOT" | "REPOSITION" | "RECOVERY" | "AERIAL";

export type MatchProbeCarMetrics = {
	slot: number;
	team: "blue" | "orange";
	touches: number;
	aerialTouches: number;
	avgBoostFuel: number;
	boostSamples: number;
	boostWasteSec: number;
	whiffCount: number;
	padSeeks: number;
	padPickups: number;
	fsmSec: Record<ProbeFsmKey, number>;
	recoveryEpisodes: number;
	recoverySuccesses: number;
	recoveryFailTimeouts: number;
	avgRecoverySec: number;
	/** Sekundy na ścianie / rampie (wall ride). */
	wallSec: number;
	/** Sekundy na suficie (n.y < −0.25). */
	ceilingSec: number;
	/** Sekundy w strefach: mid / side / corner / goal. */
	zoneSec: {
		mid: number;
		side: number;
		corner: number;
		goal: number;
	};
};

export type MatchProbeMatchMetrics = {
	seed: number;
	mode: ProbeModeId;
	seconds: number;
	blueGoals: number;
	orangeGoals: number;
	ballTouches: number;
	/** Sekundy od GO / resetu do pierwszego kontaktu (impact > 0.5). */
	kickoffFirstContactSec: number | null;
	/** Boost zużyty łącznie (oba boty) do 1. kontaktu kickoffu. */
	kickoffBoostSpent: number | null;
	/** |sign(blue.x) !== sign(orange.x)| na starcie. */
	kickoffDiagonalOk: boolean;
	/** Max zaobserwowany przyrost fuel bez pada (powinien ≈ 0 w Core). */
	maxPassiveRegenDelta: number;
	hitImpacts: number[];
	nearMissDeadHits: number;
	cars: MatchProbeCarMetrics[];
};

export type MatchProbeAggregate = {
	matchCount: number;
	mode: ProbeModeId;
	secondsPerMatch: number;
	avgBlueGoals: number;
	avgOrangeGoals: number;
	avgBallTouches: number;
	avgKickoffFirstContactSec: number | null;
	kickoffContactOver4sRate: number;
	kickoffDiagonalFailRate: number;
	avgBoostFuel: number;
	avgPadSeeks: number;
	avgPadPickups: number;
	recoveryFailRate: number;
	avgWhiffs: number;
	avgBoostWasteSec: number;
	nearMissDeadHitRate: number;
	passiveRegenSuspect: boolean;
	avgWallSec: number;
	avgCeilingSec: number;
	matches: MatchProbeMatchMetrics[];
};

export type ProbeFindingId =
	| "kickoff_slow_contact"
	| "kickoff_not_diagonal"
	| "passive_regen_leak"
	| "recovery_fail_high"
	| "pad_seek_starved"
	| "boost_waste_high"
	| "whiff_high"
	| "dead_hits_high"
	| "low_engagement"
	| "wall_ride_absent"
	| "zero_scoring";

export type ProbeFinding = {
	id: ProbeFindingId;
	severity: "info" | "warn" | "crit";
	title: string;
	detail: string;
	hintFiles: string[];
};

export type MatchProbeReport = {
	generatedAt: string;
	aggregate: MatchProbeAggregate;
	findings: ProbeFinding[];
};
