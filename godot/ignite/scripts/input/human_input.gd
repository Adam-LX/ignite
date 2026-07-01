extends Node
class_name HumanInput
## Wejście gracza — port GameInput.ts (WASD, LPM boost, PPM jump, Spacja ball cam)

var ball_cam_toggle_queued: bool = false
var _jump_queued: bool = false
var _recover_queued: bool = false
var _right_mouse_held: bool = false


func _ready() -> void:
	Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)


func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_SPACE:
			ball_cam_toggle_queued = true
			get_viewport().set_input_as_handled()
		if event.physical_keycode == KEY_ESCAPE:
			if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
				Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
			else:
				Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_RIGHT:
			if event.pressed:
				_right_mouse_held = true
				_jump_queued = true
				_recover_queued = true
			else:
				_right_mouse_held = false


func forward() -> float:
	return Input.get_action_strength("move_forward") - Input.get_action_strength("move_backward")


func yaw() -> float:
	return Input.get_action_strength("move_left") - Input.get_action_strength("move_right")


func roll() -> float:
	return Input.get_action_strength("roll_left") - Input.get_action_strength("roll_right")


func is_boosting() -> bool:
	return Input.is_action_pressed("boost")


func is_shift_down() -> bool:
	return Input.is_key_pressed(KEY_SHIFT)


func is_jump_held() -> bool:
	return _right_mouse_held


func consume_jump() -> bool:
	if not _jump_queued:
		return false
	_jump_queued = false
	_recover_queued = false
	return true


func consume_recover() -> bool:
	if not _recover_queued:
		return false
	_recover_queued = false
	return true


func consume_ball_cam_toggle() -> bool:
	if not ball_cam_toggle_queued:
		return false
	ball_cam_toggle_queued = false
	return true


func has_flip_direction() -> bool:
	return (
		Input.is_action_pressed("move_forward")
		or Input.is_action_pressed("move_backward")
		or Input.is_action_pressed("move_left")
		or Input.is_action_pressed("move_right")
	)
