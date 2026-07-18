import type { ScoringTeam } from "../game/modes";

export type BallTeamPalette = {
	trailHead: number;
	trailCore: number;
	emissive: number;
};

const BLUE: BallTeamPalette = {
	trailHead: 0x44c8e8,
	trailCore: 0x9ad8f0,
	emissive: 0x66d8ff,
};

const ORANGE: BallTeamPalette = {
	trailHead: 0xff8844,
	trailCore: 0xffbb88,
	emissive: 0xffaa66,
};

export function ballPaletteForTeam(
	team: ScoringTeam | null | undefined,
): BallTeamPalette {
	if (team === "blue") return BLUE;
	if (team === "orange") return ORANGE;
	return BLUE;
}
