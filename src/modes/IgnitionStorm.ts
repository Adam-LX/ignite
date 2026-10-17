import type { ScoringTeam } from "../game/modes";
import type { IgnitionRushController } from "./IgnitionRushController";
import type { TeamOvercharge } from "./TeamOvercharge";

/**
 * Ignition Storm — wyróżnik Ignite: Rush ∩ Overcharge w tej samej chwili.
 * Nie ma odpowiednika w RL — Field Energy „zapala” boisko podwójnie.
 */
export type IgnitionStormSnapshot = {
	active: boolean;
	team: ScoringTeam | null;
	/** 0–1 intensywność (dla VFX / HUD). */
	intensity: number;
};

export function resolveIgnitionStorm(
	rush: IgnitionRushController,
	overcharge: TeamOvercharge,
): IgnitionStormSnapshot {
	if (!rush.enabled || !overcharge.enabled) {
		return { active: false, team: null, intensity: 0 };
	}
	if (!rush.isRushActive() || !overcharge.isActive()) {
		return { active: false, team: null, intensity: 0 };
	}
	const snap = overcharge.snapshot();
	const left = snap.activeLeftSec;
	const intensity = Math.min(
		1,
		Math.max(
			0.55,
			0.55 + (left / Math.max(0.01, overcharge.activeDurationSec)) * 0.45,
		),
	);
	return { active: true, team: snap.activeTeam, intensity };
}

/** Soft-capy przy Storm — czytelne, nie broken. */
export function stormBallSpeedMul(
	baseMul: number,
	storm: IgnitionStormSnapshot,
): number {
	if (!storm.active) return baseMul;
	return Math.min(1.55, baseMul * (1.08 + storm.intensity * 0.06));
}

export function stormBoostRegenMul(
	baseMul: number,
	storm: IgnitionStormSnapshot,
): number {
	if (!storm.active) return baseMul;
	return Math.min(2.15, baseMul * (1.1 + storm.intensity * 0.08));
}
