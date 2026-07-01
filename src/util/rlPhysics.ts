/**
 * Krzywe fizyki Rocket League — źródła:
 * - https://wiki.rlbot.org/v5/botmaking/useful-game-values/
 * - https://www.smish.dev/rocket_league/ground_control/
 * - https://wiki.rlbot.org/v5/botmaking/jumping-physics/
 *
 * 1 uu (Unreal Unit) = 1 cm → 100 uu = 1 m.
 */

export const UU_PER_M = 100;

export function mpsToUu(mps: number): number {
	return mps * UU_PER_M;
}

export function uuToMps(uu: number): number {
	return uu / UU_PER_M;
}

export function uuAccelToMps2(uu: number): number {
	return uu / UU_PER_M;
}

/** Zakrzywienie trajektorii κ(v) przy pełnym skręcie (1/uu). */
export function rlSteerCurvature(forwardSpeedUu: number): number {
	const v = Math.abs(forwardSpeedUu);
	if (v < 500) return 0.006_9 - 5.84e-6 * v;
	if (v < 1000) return 0.005_61 - 3.26e-6 * v;
	if (v < 1500) return 0.004_3 - 1.95e-6 * v;
	if (v < 1750) return 0.003_025 - 1.1e-6 * v;
	if (v < 2500) return 0.001_8 - 4e-7 * v;
	return 0;
}

/** Docelowa prędkość kątowa yaw (rad/s); steer ∈ [-1, 1]. */
export function rlTargetYawRate(forwardSpeedUu: number, steer: number): number {
	if (Math.abs(steer) < 0.01) return 0;

	const vAbs = Math.abs(forwardSpeedUu);
	// Pivot przy ~0 — RL używa niskiej efektywnej prędkości do κ(v) (smish: κ ∝ steer).
	const vKappa = Math.max(vAbs, 166);
	// Przy postoju sign(steer)*steer zawsze dodatnie — trzymaj sign=1 aż auto jedzie.
	const sign = vAbs > 10 ? Math.sign(forwardSpeedUu) || 1 : 1;
	return sign * vKappa * rlSteerCurvature(vKappa) * steer;
}

/**
 * Przyspieszenie wzdłuż osi auta (uu/s²) — throttle / hamulec / coast.
 * Kodereview / RLBot piecewise throttle (max 1410 uu/s bez boosta).
 */
export function rlDriveAccelUu(
	forwardSpeedUu: number,
	throttle: number,
): number {
	const v = forwardSpeedUu;
	const absV = Math.abs(v);
	const sign = absV > 0.5 ? Math.sign(v) : 1;

	if (Math.abs(throttle) < 0.01) {
		if (absV < 0.5) return 0;
		return -sign * 525;
	}

	if (throttle * v < -0.01) {
		return -sign * 3500;
	}

	let accel = 0;
	if (absV >= 1410) accel = 0;
	else if (absV < 1400) accel = (-36 / 35) * absV + 1600;
	else accel = -16 * (absV - 1400) + 160;

	return accel * throttle;
}

/** Boost na ziemi: throttle=1 + 991.667 uu/s² (RLBot wiki). */
export function rlGroundDriveAccelUu(
	forwardSpeedUu: number,
	throttle: number,
	boosting: boolean,
): number {
	const effectiveThrottle = boosting ? 1 : throttle;
	let accel = rlDriveAccelUu(forwardSpeedUu, effectiveThrottle);
	if (boosting) accel += 991.667;
	return accel;
}

/** Boost w powietrzu (uu/s²). */
export function rlAirBoostAccelUu(): number {
	return 1058.333;
}

/** Throttle w powietrzu (uu/s²) — jumping physics wiki. */
export function rlAirThrottleAccelUu(throttle: number): number {
	if (Math.abs(throttle) < 0.01) return 0;
	if (throttle > 0) return 66.667 * throttle;
	return 33.334 * throttle;
}

/** Krzywa siły dodatkowego impulsu Psyonix (RocketSim / smish ball_simulation_3). */
const BALL_CAR_EXTRA_IMPULSE_CURVE: ReadonlyArray<readonly [number, number]> = [
	[0, 0.65],
	[500, 0.65],
	[2300, 0.55],
	[4600, 0.3],
];

export function rlPiecewiseLinear(
	x: number,
	curve: ReadonlyArray<readonly [number, number]>,
): number {
	if (curve.length === 0) return 0;
	const first = curve[0]!;
	if (x <= first[0]) return first[1];
	for (let i = 1; i < curve.length; i++) {
		const prev = curve[i - 1]!;
		const next = curve[i]!;
		if (x <= next[0]) {
			const t = (x - prev[0]) / (next[0] - prev[0]);
			return prev[1] + t * (next[1] - prev[1]);
		}
	}
	const last = curve[curve.length - 1]!;
	return last[1];
}

/** Skala impulsu car→ball vs. |Δv| w uu/s (Rocket League Psyonix layer). */
export function rlBallCarExtraImpulseFactor(relSpeedUu: number): number {
	return rlPiecewiseLinear(relSpeedUu, BALL_CAR_EXTRA_IMPULSE_CURVE);
}

/** Max prędkość auta w uu/s (Rocket League). */
export const RL_MAX_CAR_SPEED_UU = 2300;

/** Skala prędkości bocznego dodge (1..1.9) vs. prędkość wzdłuż nosa — Rocket Science #14. */
export function rlSideDodgeSpeedScale(forwardSpeedAlongNoseUu: number): number {
	const v = Math.max(0, forwardSpeedAlongNoseUu);
	return 1 + 0.9 * Math.min(v / RL_MAX_CAR_SPEED_UU, 1);
}

/** Skala backward dodge (1..2.5) — hamowanie przy jeździe do przodu. */
export function rlBackDodgeSpeedScale(forwardSpeedAlongNoseUu: number): number {
	const v = Math.max(0, forwardSpeedAlongNoseUu);
	return 1 + 1.5 * Math.min(v / RL_MAX_CAR_SPEED_UU, 1);
}

export type DodgeStick = { throttle: number; yaw: number };

/**
 * Składowe impulsu dodge (m/s) wzdłuż poziomych osi auta.
 * Forward/side base 500 uu/s; bok skaluje się liniowo z prędkością do 1.9×.
 */
export function rlDodgeImpulseComponentsMps(
	stick: DodgeStick,
	forwardSpeedAlongNoseUu: number,
): { alongFwd: number; alongSide: number } {
	const len = Math.hypot(stick.throttle, stick.yaw);
	if (len < 0.01) return { alongFwd: 0, alongSide: 0 };

	const cf = stick.throttle / len;
	const cs = stick.yaw / len;
	const sideScale = rlSideDodgeSpeedScale(forwardSpeedAlongNoseUu);

	let alongFwd = 0;
	if (cf > 0) {
		alongFwd = cf * 5.0;
	} else if (cf < 0) {
		alongFwd = cf * 5.33 * rlBackDodgeSpeedScale(forwardSpeedAlongNoseUu);
	}

	const alongSide = -cs * 5.0 * sideScale;
	return { alongFwd, alongSide };
}

/** Rzut wektora na płaszczyznę poziomą (Y=0). */
export function projectHorizontal(
	out: { x: number; y: number; z: number },
	v: { x: number; y: number; z: number },
): void {
	out.x = v.x;
	out.y = 0;
	out.z = v.z;
}

/**
 * Poziomy kierunek „przodu” auta (tylko yaw) — RL dodge / Free Cam nie śledzą pitchu.
 */
export function carHorizontalForwardFromQuat(
	q: { x: number; y: number; z: number; w: number },
	out: { x: number; y: number; z: number },
): void {
	const sinYaw = 2 * (q.w * q.y + q.z * q.x);
	const cosYaw = 1 - 2 * (q.x * q.x + q.y * q.y);
	const len = Math.hypot(sinYaw, cosYaw);
	if (len < 1e-6) {
		out.x = 0;
		out.y = 0;
		out.z = 1;
		return;
	}
	out.x = sinYaw / len;
	out.y = 0;
	out.z = cosYaw / len;
}

/** Pozioma oś „prawo” auta (cross world-up × forward). */
export function carHorizontalRightFromForward(
	fwdH: { x: number; y: number; z: number },
	out: { x: number; y: number; z: number },
): void {
	out.x = fwdH.z;
	out.y = 0;
	out.z = -fwdH.x;
	const len = Math.hypot(out.x, out.z);
	if (len < 1e-6) {
		out.x = 1;
		out.z = 0;
		return;
	}
	out.x /= len;
	out.z /= len;
}

/** Ogranicz wektor prędkości do max (m/s). */
export function clampSpeedMps(
	v: { x: number; y: number; z: number },
	maxMps: number,
): void {
	const sq = v.x * v.x + v.y * v.y + v.z * v.z;
	if (sq > maxMps * maxMps) {
		const s = maxMps / Math.sqrt(sq);
		v.x *= s;
		v.y *= s;
		v.z *= s;
	}
}
