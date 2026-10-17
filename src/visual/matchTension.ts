import type { MatchPhase } from "../modes/MatchController";

/** 0 = spokój, 1 = pełna napięcie (dogrywka / ostatnie sekundy). */
export function computeMatchTension(
	phase: MatchPhase,
	timeRemainingSec: number,
	isOvertime: boolean,
): number {
	if (phase !== "playing" && phase !== "goal_bounce") return 0;
	if (isOvertime) return 1;
	if (timeRemainingSec <= 10) return 0.55 + (10 - timeRemainingSec) * 0.045;
	if (timeRemainingSec <= 30)
		return 0.2 + ((30 - timeRemainingSec) / 20) * 0.35;
	return 0;
}
