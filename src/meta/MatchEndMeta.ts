import type { GameModeId, ScoringTeam } from "../game/modes";
import { recordDuelContractMatch } from "./duelContract";
import { type DropResult, rollMatchDrop, shouldRollDrops } from "./DropTable";
import type { CoachHint } from "./MatchCoachTracker";

export interface MatchEndMetaPayload {
	blueScore: number;
	orangeScore: number;
	humanTeam: ScoringTeam | null;
	modeId: GameModeId;
	online: boolean;
	ranked: boolean;
	coachHints?: CoachHint[];
}

export interface RankedResultPayload {
	before: number;
	after: number;
	delta: number;
}

export interface MatchEndMetaEvent {
	drop: DropResult | null;
	ranked: RankedResultPayload | null;
	coachHints: CoachHint[];
}

type MatchEndListener = (event: MatchEndMetaEvent) => void;

let listener: MatchEndListener | null = null;
let pendingRanked: RankedResultPayload | null = null;
let matchEnded = false;

export function setMatchEndListener(next: MatchEndListener | null): void {
	listener = next;
}

export function queueRankedResult(
	before: number,
	after: number,
	delta: number,
): void {
	pendingRanked = { before, after, delta };
	if (matchEnded && listener && pendingRanked) {
		listener({ drop: null, ranked: pendingRanked, coachHints: [] });
		pendingRanked = null;
	}
}

function humanWon(payload: MatchEndMetaPayload): boolean {
	const humanScore =
		payload.humanTeam === "blue"
			? payload.blueScore
			: payload.humanTeam === "orange"
				? payload.orangeScore
				: 0;
	const oppScore =
		payload.humanTeam === "blue"
			? payload.orangeScore
			: payload.humanTeam === "orange"
				? payload.blueScore
				: 0;
	return humanScore > oppScore;
}

export function processMatchEnd(
	payload: MatchEndMetaPayload,
): MatchEndMetaEvent {
	let drop: DropResult | null = null;
	const won = humanWon(payload);

	if (shouldRollDrops(payload)) {
		drop = rollMatchDrop({
			won,
			blueScore: payload.blueScore,
			orangeScore: payload.orangeScore,
			modeId: payload.modeId,
			online: payload.online,
			ranked: payload.ranked,
		});
	}

	recordDuelContractMatch(won, payload.modeId);

	matchEnded = true;

	const event: MatchEndMetaEvent = {
		drop,
		ranked: payload.ranked ? pendingRanked : null,
		coachHints: payload.coachHints ?? [],
	};

	if (payload.ranked && pendingRanked) {
		pendingRanked = null;
	}

	listener?.(event);
	return event;
}

export function resetMatchEndMeta(): void {
	matchEnded = false;
	pendingRanked = null;
}
