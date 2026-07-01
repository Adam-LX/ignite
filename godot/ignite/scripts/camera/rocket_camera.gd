class_name RocketCamera
extends Node3D
## Chase camera — port cameraFollow.ts. Flat XZ forward, global UP.

@export var target: Node3D = null
@export var ball: Node3D = null
@export var is_ball_cam: bool = false

var _last_flat_forward: Vector3 = Vector3(0.0, 0.0, -1.0)
var _initialized: bool = false

@onready var _camera: Camera3D = $Camera3D


func _ready() -> void:
	if _camera:
		_camera.fov = RlConstants.CAM_FOV


func _process(delta: float) -> void:
	if target == null or _camera == null:
		return

	var car_pos: Vector3 = target.global_position
	var target_pos: Vector3 = Vector3.ZERO
	var look_at_pos: Vector3 = Vector3.ZERO

	if is_ball_cam and ball != null:
		var ball_pos: Vector3 = ball.global_position
		var to_car: Vector3 = car_pos - ball_pos
		if to_car.length_squared() < 0.0001:
			to_car = Vector3(0.0, 0.0, 1.0)
		else:
			to_car = to_car.normalized()
		target_pos = car_pos + to_car * RlConstants.CAM_DISTANCE
		target_pos.y += RlConstants.CAM_HEIGHT * 1.05
		look_at_pos = ball_pos
	else:
		var flat_fwd: Vector3 = _extract_flat_forward(target)
		var offset: Vector3 = -flat_fwd * RlConstants.CAM_DISTANCE
		offset.y += RlConstants.CAM_HEIGHT
		offset = _apply_camera_pitch(offset, flat_fwd)
		target_pos = car_pos + offset
		look_at_pos = car_pos + flat_fwd * RlConstants.CAM_LOOK_AHEAD
		look_at_pos.y = car_pos.y + RlConstants.CAM_LOOK_AT_OFFSET_Y

	if not _initialized:
		global_position = target_pos
		_initialized = true

	var alpha: float = 1.0 - pow(1.0 - RlConstants.CAM_STIFFNESS, delta * 60.0)
	global_position = global_position.lerp(target_pos, alpha)

	_camera.look_at(look_at_pos, Vector3.UP)


func _extract_flat_forward(car: Node3D) -> Vector3:
	var car_forward: Vector3 = -car.global_transform.basis.z
	var flat: Vector3 = Vector3(car_forward.x, 0.0, car_forward.z)
	if flat.length_squared() < 0.01:
		return _last_flat_forward
	flat = flat.normalized()
	_last_flat_forward = flat
	return flat


func _apply_camera_pitch(offset: Vector3, flat_forward: Vector3) -> Vector3:
	var right: Vector3 = Vector3.UP.cross(flat_forward)
	if right.length_squared() < 1e-6:
		right = Vector3.RIGHT
	else:
		right = right.normalized()
	var angle_rad: float = deg_to_rad(RlConstants.CAM_ANGLE_DEG)
	return offset.rotated(right, angle_rad)
