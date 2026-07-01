import { t } from "../i18n";

export type GameModeId =
	| "1v1"
	| "2v2"
	| "3v3"
	| "4v4"
	| "ignition1v1"
	| "ignition";

export type ScoringTeam = "blue" | "orange";

export const MATCH_RULES = {
	durationSec: 300,
	goalPauseSec: 5,
	countdownSec: 5,
} as const;

export type ModeSpec = {
	id: GameModeId;
	label: string;
	description: string;
	playerCount: number;
	teamSize: number;
	isFFA: boolean;
};

const MODE_SPECS: Record<GameModeId, ModeSpec> = {
	"1v1": {
		id: "1v1",
		label: "1v1 Duel",
		description: "Pojedynek solo — ty kontra bot. Idealny na rozgrzewkę.",
		playerCount: 2,
		teamSize: 1,
		isFFA: false,
	},
	"2v2": {
		id: "2v2",
		label: "2v2 Doubles",
		description:
			"Dwie drużyny po dwóch. Ty + sojusznik-bot vs dwóch przeciwników.",
		playerCount: 4,
		teamSize: 2,
		isFFA: false,
	},
	"3v3": {
		id: "3v3",
		label: "3v3 Standard",
		description: "Klasyczny układ trójek — więcej akcji na boisku.",
		playerCount: 6,
		teamSize: 3,
		isFFA: false,
	},
	"4v4": {
		id: "4v4",
		label: "4v4 Chaos",
		description: "Pełne boisko — osiem aut, maksymalny chaos.",
		playerCount: 8,
		teamSize: 4,
		isFFA: false,
	},
	ignition1v1: {
		id: "ignition1v1",
		label: "Ignition Test",
		description:
			"Ty + 1 bot — power-upy Ignition na pustym boisku, bez tłoku 8 aut.",
		playerCount: 2,
		teamSize: 1,
		isFFA: true,
	},
	ignition: {
		id: "ignition",
		label: "Ignition",
		description:
			"FFA jak Rumble — 8 aut, gol w dowolnej bramce liczy się dla ostatniego dotykającego.",
		playerCount: 8,
		teamSize: 1,
		isFFA: true,
	},
};

export function isIgnitionMode(mode: GameModeId): boolean {
	return mode === "ignition" || mode === "ignition1v1";
}

export function getModeSpec(mode: GameModeId): ModeSpec {
	return MODE_SPECS[mode];
}

export function getLocalizedModeSpec(mode: GameModeId): ModeSpec {
	const base = MODE_SPECS[mode];
	return {
		...base,
		label: t(`mode.${mode}.label`),
		description: t(`mode.${mode}.description`),
	};
}

export function parseGameMode(raw: string | null | undefined): GameModeId {
	const m = raw?.toLowerCase();
	if (m && m in MODE_SPECS) return m as GameModeId;
	return "1v1";
}

export function allGameModes(): GameModeId[] {
	return ["1v1", "2v2", "3v3", "4v4", "ignition1v1", "ignition"];
}
