class_name RlPhysics
extends RefCounted
## Krzywe przyspieszenia RL — port src/util/rlPhysics.ts

static func mps_to_uu(mps: float) -> float:
	return mps * RlConstants.UU_PER_M


static func uu_accel_to_mps2(uu: float) -> float:
	return uu / RlConstants.UU_PER_M


static func rl_steer_curvature(forward_speed_uu: float) -> float:
	var v: float = absf(forward_speed_uu)
	if v < 500.0:
		return 0.006900 - 5.84e-6 * v
	if v < 1000.0:
		return 0.005610 - 3.26e-6 * v
	if v < 1500.0:
		return 0.004300 - 1.95e-6 * v
	if v < 1750.0:
		return 0.003025 - 1.1e-6 * v
	if v < 2500.0:
		return 0.001800 - 4.0e-7 * v
	return 0.0


static func rl_target_yaw_rate(forward_speed_uu: float, steer: float) -> float:
	if absf(steer) < 0.01:
		return 0.0
	var v_abs: float = absf(forward_speed_uu)
	var v_kappa: float = maxf(v_abs, 166.0)
	var sign: float = signf(forward_speed_uu) if v_abs > 10.0 else signf(steer)
	return sign * v_kappa * rl_steer_curvature(v_kappa) * steer


static func rl_drive_accel_uu(forward_speed_uu: float, throttle: float) -> float:
	var v: float = forward_speed_uu
	var abs_v: float = absf(v)
	var sign_v: float = signf(v) if abs_v > 0.5 else 1.0

	if absf(throttle) < 0.01:
		return 0.0 if abs_v < 0.5 else -sign_v * 525.0
	if throttle * v < -0.01:
		return -sign_v * 3500.0

	var accel: float = 0.0
	if abs_v >= 1410.0:
		accel = 0.0
	elif abs_v < 1400.0:
		accel = (-36.0 / 35.0) * abs_v + 1600.0
	else:
		accel = -16.0 * (abs_v - 1400.0) + 160.0
	return accel * throttle


static func rl_ground_drive_accel_uu(
	forward_speed_uu: float,
	throttle: float,
	boosting: bool,
) -> float:
	var effective: float = 1.0 if boosting else throttle
	var accel: float = rl_drive_accel_uu(forward_speed_uu, effective)
	if boosting:
		accel += 991.667
	return accel


static func rl_air_throttle_accel_uu(throttle: float) -> float:
	if absf(throttle) < 0.01:
		return 0.0
	if throttle > 0.0:
		return 66.667 * throttle
	return 33.334 * throttle


static func clamp_speed(v: Vector3, max_mps: float) -> Vector3:
	var max_sq: float = max_mps * max_mps
	if v.length_squared() > max_sq:
		return v.normalized() * max_mps
	return v


static func project_on_plane(vec: Vector3, plane_normal: Vector3) -> Vector3:
	return vec - plane_normal * vec.dot(plane_normal)
