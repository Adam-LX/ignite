class_name RocketBotAI
extends Node
## Autonomiczny bot — port BotBehavior.ts (FSM + intercept + dodge)

enum FsmState { ALIGN_SHOT, REPOSITION, RECOVERY, AERIAL }

@export var team: int = 0
@export var slot_index: int = 1

var fsm_state: FsmState = FsmState.REPOSITION
var _jump_cooldown: float = 0.0
var _dodge_phase: int = 0
var _dodge_timer: float = 0.0

var _output: SimulatedInput = SimulatedInput.create_empty()

const STEER_TOLERANCE: float = 0.15
const DODGE_BALL_MAX_DIST: float = 5.0
const DODGE_ALIGN_TOLERANCE: float = 0.2
const JUMP_BALL_MAX_DIST: float = 4.0
const JUMP_BALL_MIN_Y: float = 1.2
const JUMP_BALL_MAX_Y: float = 4.0


func think(
	car: RocketCar,
	ball_pos: Vector3,
	ball_vel: Vector3,
	dt: float,
) -> SimulatedInput:
	_output.clear_frame()
	_jump_cooldown = maxf(0.0, _jump_cooldown - dt)
	_dodge_timer = maxf(0.0, _dodge_timer - dt)

	if car.get_up_vector().dot(Vector3.UP) < RlConstants.TURTLE_UP_THRESHOLD:
		fsm_state = FsmState.RECOVERY
		_output.forward = true
		_output.jump = true
		return _output

	var car_pos: Vector3 = car.global_position
	var intercept: Vector3 = compute_intercept(ball_pos, ball_vel, car_pos)
	intercept = VectorSteering.clamp_target_from_walls(intercept, car_pos)

	var dist_ball: float = car_pos.distance_to(ball_pos)
	var ball_y: float = ball_pos.y

	if ball_y > JUMP_BALL_MIN_Y and ball_y < JUMP_BALL_MAX_Y and dist_ball < JUMP_BALL_MAX_DIST:
		fsm_state = FsmState.AERIAL
	elif fsm_state == FsmState.RECOVERY:
		fsm_state = FsmState.REPOSITION

	var target: Vector3 = intercept
	match fsm_state:
		FsmState.REPOSITION:
			target = intercept
		FsmState.ALIGN_SHOT, FsmState.AERIAL:
			target = ball_pos

	var drive: Dictionary = VectorSteering.steer_to_target(car, target, {"max_yaw": 0.35})
	_apply_drive(drive)

	if _should_front_flip_dodge(car, ball_pos):
		_run_dodge_sequence(dt)
	elif fsm_state == FsmState.ALIGN_SHOT and dist_ball < JUMP_BALL_MAX_DIST:
		if absf(drive["yaw"]) < STEER_TOLERANCE:
			_output.boost = dist_ball > 8.0
			if ball_y > 0.5 and _jump_cooldown <= 0.0 and car.is_on_ground():
				_output.jump = true
				_jump_cooldown = 0.8

	if dist_ball < 12.0 and absf(drive["yaw"]) < STEER_TOLERANCE:
		fsm_state = FsmState.ALIGN_SHOT
	elif dist_ball > 20.0:
		fsm_state = FsmState.REPOSITION

	return _output


static func compute_intercept(
	ball_pos: Vector3,
	ball_vel: Vector3,
	bot_pos: Vector3,
	max_speed: float = RlConstants.CAR_MAX_SPEED,
) -> Vector3:
	var dist: float = bot_pos.distance_to(ball_pos)
	var t: float = dist / maxf(max_speed, 4.0)
	var out: Vector3 = ball_pos + ball_vel * t
	out.y = ball_pos.y
	return out


func _apply_drive(drive: Dictionary) -> void:
	if drive["forward"] > 0.05:
		_output.forward = true
	elif drive["forward"] < -0.05:
		_output.backward = true
	if drive["left"]:
		_output.left = true
	if drive["right"]:
		_output.right = true


func _should_front_flip_dodge(car: RocketCar, ball_pos: Vector3) -> bool:
	var car_pos: Vector3 = car.global_position
	if car_pos.distance_to(ball_pos) > DODGE_BALL_MAX_DIST:
		return false
	var car_fwd: Vector3 = -car.global_transform.basis.z
	car_fwd.y = 0.0
	car_fwd = car_fwd.normalized()
	var to_ball: Vector3 = ball_pos - car_pos
	to_ball.y = 0.0
	to_ball = to_ball.normalized()
	return car_fwd.dot(to_ball) > (1.0 - DODGE_ALIGN_TOLERANCE)


func _run_dodge_sequence(dt: float) -> void:
	if _dodge_phase == 0:
		_output.jump = true
		_dodge_phase = 1
		_dodge_timer = 0.12
	elif _dodge_phase == 1 and _dodge_timer <= 0.0:
		_output.forward = true
		_output.jump = true
		_dodge_phase = 0
