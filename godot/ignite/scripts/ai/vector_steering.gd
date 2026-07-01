class_name VectorSteering
extends RefCounted
## Vector steering na płaszczyźnie XZ — port vectorSteer() z BotBehavior.ts


static func steer_to_target(
	car: RocketCar,
	target: Vector3,
	opts: Dictionary = {},
) -> Dictionary:
	var arrive_radius: float = opts.get("arrive_radius", 2.2)
	var max_yaw: float = opts.get("max_yaw", 1.0)
	var car_pos: Vector3 = car.global_position

	var car_fwd: Vector3 = -car.global_transform.basis.z
	car_fwd.y = 0.0
	if car_fwd.length_squared() < 1e-6:
		car_fwd = Vector3(0.0, 0.0, -1.0)
	else:
		car_fwd = car_fwd.normalized()

	var to_target: Vector3 = target - car_pos
	to_target.y = 0.0
	var dist: float = to_target.length()
	if dist < 0.05:
		return {"forward": 1.0, "yaw": 0.0, "left": false, "right": false}

	to_target /= dist
	var cross_y: float = car_fwd.cross(to_target).y
	var dot: float = car_fwd.dot(to_target)
	var yaw: float = clampf(cross_y * 2.5, -max_yaw, max_yaw)

	var forward: float = 1.0
	if dot < 0.3:
		forward = 0.4
	elif dist < arrive_radius:
		forward = clampf(dist / arrive_radius, 0.25, 1.0)

	return {
		"forward": forward,
		"yaw": yaw,
		"left": yaw > 0.05,
		"right": yaw < -0.05,
	}


static func clamp_target_from_walls(target: Vector3, car_pos: Vector3) -> Vector3:
	var out: Vector3 = target
	if absf(car_pos.x) > RlConstants.ARENA_HALF_WIDTH - RlConstants.WALL_MARGIN:
		out.x = 0.0
	if absf(car_pos.z) > RlConstants.ARENA_HALF_LENGTH - RlConstants.WALL_MARGIN:
		out.z = 0.0
	return out
