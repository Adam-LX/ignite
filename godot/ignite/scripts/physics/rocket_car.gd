class_name RocketCar
extends RigidBody3D
## Rocket League hovercar — port src/physics/RocketCar.ts
## Godot 4: -Z = przód, +Y = góra, +X = prawo

@export var is_bot: bool = false

var boost_fuel: float = 1.0

var _wheels_grounded: int = 0
var _is_grounded: bool = false
var _disable_suspension_timer: float = 0.0
var _jump_cooldown: float = 0.0
var _recovery_cooldown: float = 0.0
var _jump_count: int = 0

var _last_throttle: float = 0.0
var _last_yaw: float = 0.0
var _last_roll: float = 0.0
var _last_boosting: bool = false
var _last_drifting: bool = false

var _surface_normal: Vector3 = Vector3.UP
var _ground_drive_velocity: Vector3 = Vector3.ZERO
var _should_apply_ground_drive: bool = false

var _wheel_hits: Array = []
var _suspension_rays: Array[RayCast3D] = []

var _simulated_input: SimulatedInput = SimulatedInput.create_empty()
var _simulated_adapter: SimulatedControlInput = SimulatedControlInput.new(_simulated_input)
var _human_input: HumanInput = null

var _tmp_fwd: Vector3 = Vector3.ZERO
var _tmp_right: Vector3 = Vector3.ZERO
var _tmp_up: Vector3 = Vector3.ZERO
var _tmp_vel: Vector3 = Vector3.ZERO


func _ready() -> void:
	mass = RlConstants.CAR_MASS
	linear_damp = RlConstants.CAR_LINEAR_DAMP
	angular_damp = RlConstants.CAR_ANGULAR_DAMP
	continuous_cd = true
	collision_layer = 2
	collision_mask = 1 | 4
	contact_monitor = true
	max_contacts_reported = 4

	for i in RlConstants.CORNER_OFFSETS.size():
		_wheel_hits.append({"hit": false, "distance": RlConstants.HOVER_SUSPENSION_MAX, "point": Vector3.ZERO})

	if not is_bot:
		_human_input = HumanInput.new()
		add_child(_human_input)

	_setup_suspension_rays()


func _setup_suspension_rays() -> void:
	var container := Node3D.new()
	container.name = "SuspensionRays"
	add_child(container)

	for i in RlConstants.CORNER_OFFSETS.size():
		var ray := RayCast3D.new()
		ray.name = "Ray_%d" % i
		ray.position = RlConstants.CORNER_OFFSETS[i]
		ray.target_position = Vector3(0.0, -RlConstants.HOVER_SUSPENSION_MAX, 0.0)
		ray.hit_from_inside = false
		ray.collision_mask = 1
		ray.enabled = true
		container.add_child(ray)
		_suspension_rays.append(ray)


func get_car_axes() -> Dictionary:
	var b: Basis = global_transform.basis
	return {
		"forward": -b.z,
		"up": b.y,
		"right": b.x,
	}


func get_forward_vector() -> Vector3:
	return get_car_axes()["forward"]


func get_up_vector() -> Vector3:
	return get_car_axes()["up"]


func is_on_ground() -> bool:
	return _is_grounded


func get_wheels_grounded() -> int:
	return _wheels_grounded


func consume_ball_cam_toggle() -> bool:
	if _human_input == null:
		return false
	return _human_input.consume_ball_cam_toggle()


func get_human_input() -> HumanInput:
	return _human_input


func is_boosting() -> bool:
	return _last_boosting


func set_bot_input(input: SimulatedInput) -> void:
	_simulated_input = input
	_simulated_adapter = SimulatedControlInput.new(_simulated_input)


func _process(delta: float) -> void:
	var input = _get_control_input()
	control(input, delta)


func control(input, dt: float) -> void:
	_last_throttle = input.forward()
	_last_yaw = input.yaw()
	_last_roll = input.roll()
	_last_boosting = input.is_boosting() and boost_fuel > 0.0
	_last_drifting = input.is_shift_down()

	_jump_cooldown = maxf(0.0, _jump_cooldown - dt)
	_recovery_cooldown = maxf(0.0, _recovery_cooldown - dt)

	if input.consume_jump():
		_cast_suspension()
		if get_up_vector().dot(Vector3.UP) < RlConstants.TURTLE_UP_THRESHOLD:
			_try_turtle_recovery()
		elif (
			_wheels_grounded >= RlConstants.HOVER_GROUNDED_MIN_WHEELS
			and _disable_suspension_timer <= 0.0
			and _jump_cooldown <= 0.0
		):
			_perform_lift_off_jump()

	if not _last_boosting:
		var regen: float = (
			RlConstants.CAR_BOOST_REGEN_GROUND
			if _is_grounded
			else RlConstants.CAR_BOOST_REGEN_AIR
		)
		boost_fuel = minf(1.0, boost_fuel + dt * regen)


func _get_control_input():
	if is_bot:
		_simulated_adapter.reset_jump_consume()
		return _simulated_adapter
	return _human_input


func _physics_process(delta: float) -> void:
	_disable_suspension_timer = maxf(0.0, _disable_suspension_timer - delta)
	integrate_hover(delta)
	if _should_apply_ground_drive:
		linear_velocity = _ground_drive_velocity
		_should_apply_ground_drive = false


func integrate_hover(dt: float) -> void:
	_cast_suspension()
	_is_grounded = (
		_wheels_grounded >= RlConstants.HOVER_GROUNDED_MIN_WHEELS
		and _disable_suspension_timer <= 0.0
	)

	var car_forward: Vector3 = get_forward_vector()
	var is_vertical_stand: bool = absf(car_forward.dot(Vector3.UP)) > RlConstants.VERTICAL_STAND_THRESHOLD
	var stable_drive: bool = (
		_is_grounded
		and get_up_vector().dot(Vector3.UP) >= RlConstants.UPRIGHT_DRIVE_THRESHOLD
		and not is_vertical_stand
	)

	if stable_drive:
		_apply_suspension_forces()
		_apply_ground_drive(dt)
		_lock_ground_pitch_roll()
		linear_damp = RlConstants.CAR_LINEAR_DAMP
		angular_damp = RlConstants.CAR_ANGULAR_DAMP
	else:
		if _wheels_grounded > 0 and _disable_suspension_timer <= 0.0:
			_apply_suspension_forces()
		if _wheels_grounded < RlConstants.HOVER_GROUNDED_MIN_WHEELS:
			_apply_aerial_torque_control(dt)
		_apply_air_throttle(dt)
		linear_damp = RlConstants.CAR_AIR_LINEAR_DAMP


func _cast_suspension() -> void:
	_wheels_grounded = 0
	var normal_acc: Vector3 = Vector3.ZERO

	for i in _suspension_rays.size():
		var ray: RayCast3D = _suspension_rays[i]
		ray.force_raycast_update()
		var wh: Dictionary = _wheel_hits[i]

		if ray.is_colliding():
			var dist: float = ray.get_collision_point().distance_to(ray.global_position)
			wh["hit"] = dist <= RlConstants.HOVER_SUSPENSION_REST + 0.1
			wh["distance"] = dist
			wh["point"] = ray.get_collision_point()
			if wh["hit"]:
				var n: Vector3 = ray.get_collision_normal()
				if n.y < 0.0:
					n = -n
				normal_acc += n
				_wheels_grounded += 1
		else:
			wh["hit"] = false
			wh["distance"] = RlConstants.HOVER_SUSPENSION_MAX

	if _wheels_grounded > 0:
		_surface_normal = normal_acc.normalized()
	else:
		_surface_normal = Vector3.UP


func _apply_suspension_forces() -> void:
	if _disable_suspension_timer > 0.0:
		return

	var car_up: Vector3 = get_up_vector()
	var linvel: Vector3 = linear_velocity
	var angvel: Vector3 = angular_velocity
	var origin: Vector3 = global_position

	for i in _wheel_hits.size():
		var wh: Dictionary = _wheel_hits[i]
		if not wh["hit"]:
			continue

		var compression: float = RlConstants.HOVER_SUSPENSION_REST - wh["distance"]
		if compression <= 0.0:
			continue

		var point: Vector3 = wh["point"]
		var r: Vector3 = point - origin
		var vel_at: Vector3 = linvel + angvel.cross(r)
		var v_along: float = vel_at.dot(car_up)
		var force_mag: float = (
			RlConstants.HOVER_STIFFNESS * compression - RlConstants.HOVER_DAMPING * v_along
		)
		if force_mag <= 0.0:
			continue

		apply_force(car_up * force_mag, point)

	if _is_on_wall_or_ramp():
		apply_central_force(Vector3.UP * mass * RlConstants.WORLD_GRAVITY)
		apply_central_force(-_surface_normal * RlConstants.HOVER_WALL_STICK_ACCEL * mass)


func _is_on_wall_or_ramp() -> bool:
	return _is_grounded and _surface_normal.y < RlConstants.CAR_WALL_NORMAL_FLAT_THRESHOLD


func _perform_lift_off_jump() -> void:
	apply_central_impulse(Vector3.UP * mass * RlConstants.CAR_JUMP_IMPULSE_MUL)
	_disable_suspension_timer = 0.2
	_jump_cooldown = 1.5
	_is_grounded = false
	_jump_count = 1
	_wheels_grounded = 0


func _try_turtle_recovery() -> void:
	if _recovery_cooldown > 0.0:
		return
	if get_up_vector().dot(Vector3.UP) >= RlConstants.TURTLE_UP_THRESHOLD:
		return

	var axes: Dictionary = get_car_axes()
	var roll_axis: Vector3 = axes["forward"]
	var roll_sign: float = 1.0 if get_car_axes()["right"].dot(Vector3.UP) >= 0.0 else -1.0
	var roll_impulse: float = mass * 12.0 * roll_sign
	apply_torque_impulse(roll_axis * roll_impulse)

	_recovery_cooldown = 1.0
	_disable_suspension_timer = 0.15
	_is_grounded = false


func _apply_aerial_torque_control(dt: float) -> void:
	if _wheels_grounded >= RlConstants.HOVER_GROUNDED_MIN_WHEELS:
		return

	var pitch_force: float = mass * RlConstants.AERIAL_PITCH_MUL * dt
	var yaw_force: float = mass * RlConstants.AERIAL_YAW_MUL * dt
	var roll_force: float = mass * RlConstants.AERIAL_ROLL_MUL * dt

	var axes: Dictionary = get_car_axes()
	_tmp_fwd = axes["forward"]
	_tmp_right = axes["right"]
	_tmp_up = axes["up"]

	var is_vertical: bool = absf(_tmp_fwd.dot(Vector3.UP)) > RlConstants.VERTICAL_STAND_THRESHOLD
	var vertical_roll_force: float = roll_force * RlConstants.AERIAL_VERTICAL_ROLL_BOOST

	var has_input: bool = (
		absf(_last_throttle) > 0.01
		or absf(_last_yaw) > 0.01
		or absf(_last_roll) > 0.01
	)

	if _last_throttle > 0.01:
		apply_torque_impulse(_tmp_right * pitch_force)
	elif _last_throttle < -0.01:
		apply_torque_impulse(-_tmp_right * pitch_force)

	if is_vertical:
		if _last_yaw > 0.01:
			apply_torque_impulse(_tmp_fwd * vertical_roll_force)
		elif _last_yaw < -0.01:
			apply_torque_impulse(-_tmp_fwd * vertical_roll_force)
	else:
		if _last_yaw > 0.01:
			apply_torque_impulse(_tmp_up * yaw_force)
		elif _last_yaw < -0.01:
			apply_torque_impulse(-_tmp_up * yaw_force)

	if _last_roll > 0.01:
		apply_torque_impulse(_tmp_fwd * roll_force)
	elif _last_roll < -0.01:
		apply_torque_impulse(-_tmp_fwd * roll_force)

	if has_input:
		angular_damp = RlConstants.CAR_AIR_ANGULAR_DAMP_ACTIVE
	else:
		angular_damp = RlConstants.CAR_AIR_ANGULAR_DAMP_IDLE


func _apply_air_throttle(dt: float) -> void:
	if absf(_last_throttle) < 0.01 and not _last_boosting:
		return

	var fwd: Vector3 = get_forward_vector()
	var accel_uu: float = RlPhysics.rl_air_throttle_accel_uu(_last_throttle)
	var accel: float = RlPhysics.uu_accel_to_mps2(accel_uu)
	if _last_boosting:
		accel += RlConstants.CAR_BOOST_ACCEL
		boost_fuel = maxf(0.0, boost_fuel - dt * RlConstants.CAR_BOOST_DRAIN)
	apply_central_force(fwd * accel * mass)


func _apply_ground_drive(dt: float) -> void:
	if _wheels_grounded < RlConstants.HOVER_GROUNDED_MIN_WHEELS:
		return
	if get_up_vector().dot(Vector3.UP) < RlConstants.UPRIGHT_DRIVE_THRESHOLD:
		return

	var surf_up: Vector3 = _surface_normal
	var fwd: Vector3 = RlPhysics.project_on_plane(get_forward_vector(), surf_up).normalized()
	var right: Vector3 = RlPhysics.project_on_plane(get_car_axes()["right"], surf_up).normalized()
	if fwd.length_squared() < 1e-6:
		return

	var vel: Vector3 = linear_velocity
	var vel_up: Vector3 = surf_up * vel.dot(surf_up)
	var vel_plane: Vector3 = vel - vel_up

	var speed_fwd: float = vel_plane.dot(fwd)
	var speed_right: float = vel_plane.dot(right)

	var accel_uu: float = RlPhysics.rl_ground_drive_accel_uu(
		RlPhysics.mps_to_uu(speed_fwd),
		_last_throttle,
		_last_boosting,
	)
	speed_fwd += RlPhysics.uu_accel_to_mps2(accel_uu) * dt
	var max_fwd: float = (
		RlConstants.CAR_MAX_SPEED if _last_boosting else RlConstants.CAR_THROTTLE_MAX_SPEED
	)
	speed_fwd = clampf(speed_fwd, -RlConstants.CAR_REVERSE_MAX_SPEED, max_fwd)

	var grip: float = (
		RlConstants.CAR_DRIFT_GRIP if _last_drifting else RlConstants.CAR_LATERAL_GRIP
	)
	speed_right *= maxf(0.0, 1.0 - grip * dt)
	if not _last_drifting and absf(speed_right) < 0.05:
		speed_right = 0.0

	if not _last_drifting and absf(_last_throttle) > 0.08:
		var spd: float = Vector2(speed_fwd, speed_right).length()
		var sign: float = 1.0 if speed_fwd >= 0.0 else -1.0
		speed_fwd = lerpf(speed_fwd, spd * sign, dt * RlConstants.CAR_GROUND_ALIGN)
		speed_right = lerpf(speed_right, 0.0, dt * RlConstants.CAR_GROUND_ALIGN * 1.6)

	_ground_drive_velocity = RlPhysics.clamp_speed(
		fwd * speed_fwd + right * speed_right + vel_up,
		RlConstants.CAR_MAX_SPEED if _last_boosting else RlConstants.CAR_THROTTLE_MAX_SPEED + 0.5,
	)
	_should_apply_ground_drive = true

	if not _last_drifting:
		var av: Vector3 = angular_velocity
		if absf(_last_yaw) < 0.01:
			if absf(av.y) > 1e-4:
				angular_velocity = Vector3(av.x, 0.0, av.z)
		else:
			var target: float = RlPhysics.rl_target_yaw_rate(
				RlPhysics.mps_to_uu(speed_fwd),
				_last_yaw,
			)
			var max_delta: float = RlConstants.CAR_YAW_ANG_ACCEL * dt
			var new_y: float = av.y + clampf(target - av.y, -max_delta, max_delta)
			angular_velocity = Vector3(av.x, new_y, av.z)

	if _last_boosting:
		boost_fuel = maxf(0.0, boost_fuel - dt * RlConstants.CAR_BOOST_DRAIN)


func _lock_ground_pitch_roll() -> void:
	if _wheels_grounded < RlConstants.HOVER_GROUNDED_MIN_WHEELS:
		return
	if get_up_vector().dot(Vector3.UP) < RlConstants.UPRIGHT_DRIVE_THRESHOLD:
		return
	if not _is_grounded or _surface_normal.y < RlConstants.CAR_WALL_NORMAL_FLAT_THRESHOLD:
		return

	var av: Vector3 = angular_velocity
	if absf(av.x) > 1e-4 or absf(av.z) > 1e-4:
		angular_velocity = Vector3(0.0, av.y, 0.0)

	var euler: Vector3 = global_transform.basis.get_euler(EULER_ORDER_YXZ)
	if absf(euler.x) > 0.001 or absf(euler.z) > 0.001:
		euler.x = 0.0
		euler.z = 0.0
		var b: Basis = Basis.from_euler(euler, EULER_ORDER_YXZ)
		global_transform = Transform3D(b, global_position)
