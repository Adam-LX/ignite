class_name SimulatedControlInput
extends ControlInput
## Adapter SimulatedInput → ControlInput

var _input: SimulatedInput
var _jump_consumed: bool = false


func _init(input: SimulatedInput) -> void:
	_input = input


func forward() -> float:
	if _input.forward:
		return 1.0
	if _input.backward:
		return -1.0
	return 0.0


func yaw() -> float:
	if _input.left and not _input.right:
		return 1.0
	if _input.right and not _input.left:
		return -1.0
	return 0.0


func roll() -> float:
	if _input.roll_left and not _input.roll_right:
		return 1.0
	if _input.roll_right and not _input.roll_left:
		return -1.0
	return 0.0


func is_boosting() -> bool:
	return _input.boost


func is_jump_held() -> bool:
	return _input.jump


func consume_jump() -> bool:
	if _jump_consumed or not _input.jump:
		return false
	_jump_consumed = true
	return true


func has_flip_direction() -> bool:
	return (
		_input.forward
		or _input.backward
		or _input.left
		or _input.right
	)


func reset_jump_consume() -> void:
	_jump_consumed = false
