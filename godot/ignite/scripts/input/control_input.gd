class_name ControlInput
extends RefCounted
## Interfejs wejścia — port ControlInput.ts


func forward() -> float:
	return 0.0


func yaw() -> float:
	return 0.0


func roll() -> float:
	return 0.0


func is_boosting() -> bool:
	return false


func is_shift_down() -> bool:
	return false


func is_jump_held() -> bool:
	return false


func consume_jump() -> bool:
	return false


func consume_recover() -> bool:
	return false


func has_flip_direction() -> bool:
	return false
