/** Ranked UX (lobby, ELO, raport wyniku) — M4. */
export const RANKED_UI_ENABLED = true;

export function effectiveRanked(ranked: boolean): boolean {
	return RANKED_UI_ENABLED && ranked;
}
