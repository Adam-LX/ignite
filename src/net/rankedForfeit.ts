import type { GameModeId } from "../game/modes";
import { teamForSlot } from "./protocol";

/** Forfeit = 3–0 dla drużyny zwycięzcy. */
export function forfeitMatchScores(
	loserSlot: number,
	mode: GameModeId = "1v1",
): {
	blueScore: number;
	orangeScore: number;
} {
	return teamForSlot(loserSlot, mode) === "blue"
		? { blueScore: 0, orangeScore: 3 }
		: { blueScore: 3, orangeScore: 0 };
}
