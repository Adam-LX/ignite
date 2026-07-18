import type Player from "../util/Player";
import { RL_CAR, RL_HOVER } from "../util/rlConstants";
import { isMeridianArenaActive } from "../visual/meridianArena";

/** Pełne turtle — tylko jump / auto-roll, zero gazu. */
export const BOT_TURTLE_UP_THRESHOLD = -0.2;

/** Bok / pochylenie — sieć wyłączona, heurystyka recovery. */
export const BOT_UNSTABLE_UP_THRESHOLD = 0.4;

/**
 * Meridian: „góra” = normalna powierzchni sfery, nie world +Y.
 * Klasyczny próg surfaceY < 0.5 blokował boty niemal wszędzie poza nadirem.
 *
 * Flat arena: wall/ceiling ride NIE jest unstable — align względem surfaceNormal.
 */
export function isBotUnstable(player: Player): boolean {
	const up = player.getUpward();
	const wheels = player.getWheelsGroundedCount();
	const n = player.getSurfaceNormal();

	if (isMeridianArenaActive()) {
		const align = up.x * n.x + up.y * n.y + up.z * n.z;
		if (align < BOT_TURTLE_UP_THRESHOLD) return true;
		if (align < 0.2) return true;
		if (
			wheels < RL_HOVER.groundedMinWheels &&
			align < BOT_UNSTABLE_UP_THRESHOLD
		) {
			return true;
		}
		return false;
	}

	/** Wall-ride / ceiling — unstable tylko gdy dach względem bandy. */
	if (
		player.isOnWallOrRamp() &&
		n.y < RL_CAR.wallNormalFlatThreshold
	) {
		const align = up.x * n.x + up.y * n.y + up.z * n.z;
		if (align < BOT_TURTLE_UP_THRESHOLD) return true;
		if (align < 0.15) return true;
		if (
			wheels < RL_HOVER.groundedMinWheels &&
			align < BOT_UNSTABLE_UP_THRESHOLD
		) {
			return true;
		}
		return false;
	}

	const upY = up.y;
	const height = player.getPosition().y;
	const inAir =
		wheels < 1 && !player.isOnGround() && !player.isOnWallOrRamp();

	/** Aerial wysoko — recovery tylko przy pełnym turtle (nie gasić lotu). */
	if (inAir && height > 2.2) {
		return upY < BOT_TURTLE_UP_THRESHOLD;
	}

	if (upY < BOT_TURTLE_UP_THRESHOLD) return true;
	/** Blisko murawy / z kontaktem — przechylenie. */
	if (upY < 0.12 && (wheels >= 1 || height < 1.5)) return true;
	if (
		wheels < RL_HOVER.groundedMinWheels &&
		upY < BOT_UNSTABLE_UP_THRESHOLD &&
		height < 2.0
	) {
		return true;
	}
	return false;
}

export function isBotStableOnWheels(player: Player): boolean {
	const up = player.getUpward();
	const n = player.getSurfaceNormal();
	const wheelsOk =
		player.getWheelsGroundedCount() >= RL_HOVER.groundedMinWheels;

	if (isMeridianArenaActive()) {
		const align = up.x * n.x + up.y * n.y + up.z * n.z;
		return align >= 0.7 && wheelsOk;
	}

	if (player.isOnWallOrRamp() && n.y < RL_CAR.wallNormalFlatThreshold) {
		const align = up.x * n.x + up.y * n.y + up.z * n.z;
		return align >= 0.7 && wheelsOk;
	}

	return up.y >= 0.7 && wheelsOk && n.y >= 0.85;
}

/** 0..1 — szybkość i częstotliwość powrotu na 4 koła w meczu. */
export function computeMatchRecoveryEfficiency(
	unstableSamples: number,
	observeSamples: number,
	recoveryDurationsSec: number[],
): number {
	if (observeSamples <= 0) return 1;
	const stableRatio = 1 - unstableSamples / observeSamples;
	if (recoveryDurationsSec.length === 0) {
		return unstableSamples > 0 ? stableRatio * 0.35 : 1;
	}
	const avgSec =
		recoveryDurationsSec.reduce((sum, t) => sum + t, 0) /
		recoveryDurationsSec.length;
	const speedScore = Math.max(0, Math.min(1, 1 - (avgSec - 0.45) / 2.8));
	return Math.max(0, Math.min(1, speedScore * 0.62 + stableRatio * 0.38));
}
