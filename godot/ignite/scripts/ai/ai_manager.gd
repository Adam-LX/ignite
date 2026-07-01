class_name AIManager
extends Node
## Orkiestracja botów — port AIManager.ts

var _bots: Dictionary = {}


func register_bot(slot_index: int, ai: RocketBotAI) -> void:
	_bots[slot_index] = ai


func think_all(
	cars: Array,
	ball: RigidBody3D,
	dt: float,
) -> void:
	if ball == null:
		return
	var ball_pos: Vector3 = ball.global_position
	var ball_vel: Vector3 = ball.linear_velocity

	for car in cars:
		if not car is RocketCar:
			continue
		var rocket: RocketCar = car
		if not rocket.is_bot:
			continue
		var ai: RocketBotAI = rocket.get_node_or_null("RocketBotAI")
		if ai == null:
			continue
		var input: SimulatedInput = ai.think(rocket, ball_pos, ball_vel, dt)
		rocket.set_bot_input(input)
