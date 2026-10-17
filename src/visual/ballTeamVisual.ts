import type { ScoringTeam } from "../game/modes";

export type BallTeamPalette = {
	trailHead: number;
	trailCore: number;
	emissive: number;
};

const BLUE: BallTeamPalette = {
	trailHead: 0x55e0ff,
	trailCore: 0xb8f0ff,
	emissive: 0x77eeff,
};

const ORANGE: BallTeamPalette = {
	trailHead: 0xff9944,
	trailCore: 0xffcc88,
	emissive: 0xffbb66,
};

export function ballPaletteForTeam(
	team: ScoringTeam | null | undefined,
): BallTeamPalette {
	if (team === "blue") return BLUE;
	if (team === "orange") return ORANGE;
	return BLUE;
}
