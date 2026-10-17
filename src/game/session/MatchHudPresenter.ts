import { HOVER_SAFE_MODE } from "../../debug/config";
import { t } from "../../i18n";
import type { IgnitionManager, PowerUpHudState } from "../../modes/IgnitionManager";
import type { IgnitionRushController } from "../../modes/IgnitionRushController";
import type { IgnitionZonesController } from "../../modes/IgnitionZones";
import type { MatchPhase } from "../../modes/MatchController";
import type { MeridianController, MeridianLivePossession } from "../../modes/MeridianController";
import type { WeeklyMutatorDef } from "../../modes/MutatorRegistry";
import {
	resolveIgnitionStorm,
	type IgnitionStormSnapshot,
} from "../../modes/IgnitionStorm";
import type { TeamOvercharge } from "../../modes/TeamOvercharge";
import type { OnlineRole } from "../../net/protocol";
import type { RoomClient } from "../../net/RoomClient";
import type { RlHudState } from "../../ui/RlHud";
import { computeMatchTension } from "../../visual/matchTension";
import type { CarEntity } from "../CarEntity";

export type OnlineHudContext = {
	role: OnlineRole;
	ranked: boolean;
	roomClient: RoomClient;
} | null;

/** Etykieta trybu + Online / Ranked. */
export function onlineModeLabel(
	base: string,
	online: OnlineHudContext,
): string {
	if (!online) return base;
	const tag = online.ranked ? t("match.rankedTag") : "";
	return `${base} · Online${tag}`;
}

export function rematchHudFlags(
	online: OnlineHudContext,
	phase: MatchPhase,
): Pick<RlHudState, "rematchHost" | "rematchGuestWait"> {
	if (!online || phase !== "finished") {
		return {};
	}
	if (online.role === "host") {
		return { rematchHost: true };
	}
	return { rematchGuestWait: true };
}

export function rankedHudFields(
	online: OnlineHudContext,
): Pick<RlHudState, "isRanked" | "rankedElo"> {
	if (!online?.ranked) {
		return { isRanked: false, rankedElo: null };
	}
	return {
		isRanked: true,
		rankedElo: online.roomClient.elo,
	};
}

export function powerUpHudFields(opts: {
	online: OnlineHudContext;
	ignition: IgnitionManager;
	humanSlot: number;
}): Pick<RlHudState, "powerUp"> {
	const disabled: PowerUpHudState = {
		enabled: false,
		held: null,
		pickProgress: 0,
		pickSecondsLeft: 0,
		activeKind: null,
		activeProgress: 0,
		activeSecondsLeft: 0,
	};
	if (
		HOVER_SAFE_MODE ||
		!opts.ignition.isEnabled() ||
		opts.online?.role === "guest"
	) {
		return { powerUp: disabled };
	}
	return { powerUp: opts.ignition.getHudState(opts.humanSlot) };
}

export function juiceHudFields(
	phase: MatchPhase,
	timeRemainingSec: number,
	isOvertime: boolean,
	humanGoalStreak: number,
): Pick<RlHudState, "onFire" | "matchTension"> {
	return {
		onFire: humanGoalStreak >= 2,
		matchTension: computeMatchTension(phase, timeRemainingSec, isOvertime),
	};
}

export function experimentalHudFields(opts: {
	rush: IgnitionRushController;
	overcharge: TeamOvercharge;
	zones: IgnitionZonesController;
	meridian: MeridianController;
	weeklyMutator: WeeklyMutatorDef | null;
	humanCar: CarEntity;
	lastMeridianHalf: "blue" | "orange" | "neutral";
	lastMeridianLive: MeridianLivePossession | null;
}): Pick<
	RlHudState,
	| "rush"
	| "overcharge"
	| "zoneBuff"
	| "mutator"
	| "fieldEnergy"
	| "storm"
	| "meridianHalf"
	| "meridianLive"
> {
	const rushSnap = opts.rush.snapshot();
	const ocSnap = opts.overcharge.snapshot();
	const storm: IgnitionStormSnapshot = resolveIgnitionStorm(
		opts.rush,
		opts.overcharge,
	);
	const zoneBuff = opts.zones.enabled
		? opts.zones.getBuff(opts.humanCar.slotIndex)
		: null;
	return {
		rush: opts.rush.enabled
			? {
					active: rushSnap.rushActive,
					nextInSec: rushSnap.nextRushInSec,
					phaseLeftSec: rushSnap.rushActive
						? Math.max(
								0,
								opts.rush.rushDurationSec - rushSnap.phaseElapsedSec,
							)
						: null,
				}
			: null,
		overcharge: opts.overcharge.enabled
			? {
					blue: ocSnap.blueCharge,
					orange: ocSnap.orangeCharge,
					activeTeam: ocSnap.activeTeam,
					activeLeftSec: ocSnap.activeLeftSec,
				}
			: null,
		zoneBuff: zoneBuff
			? { kind: zoneBuff.kind, leftSec: zoneBuff.leftSec }
			: null,
		mutator: opts.weeklyMutator
			? {
					id: opts.weeklyMutator.id,
					nameKey: opts.weeklyMutator.nameKey,
					descKey: opts.weeklyMutator.descKey,
				}
			: null,
		fieldEnergy: opts.rush.enabled,
		storm: storm.active
			? { active: true, team: storm.team, intensity: storm.intensity }
			: null,
		meridianHalf: opts.meridian.enabled ? opts.lastMeridianHalf : null,
		meridianLive: opts.meridian.enabled ? opts.lastMeridianLive : null,
	};
}
