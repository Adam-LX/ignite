extends Node
## Orkiestracja meczu — port GameSession.ts (MVP)

@onready var human_car: RocketCar = $MatchRoot/Cars/CarHuman
@onready var bot_car: RocketCar = $MatchRoot/Cars/CarBot
@onready var ball: RigidBody3D = $MatchRoot/Ball
@onready var camera_rig: RocketCamera = $CameraRig
@onready var ai_manager: AIManager = $AIManager

var _ball_cam: bool = false


func _ready() -> void:
	if camera_rig:
		camera_rig.target = human_car
		camera_rig.ball = ball
	if human_car:
		human_car.global_position = Vector3(0.0, RlConstants.CAR_HOVER_CENTER_Y, -10.0)
	if bot_car:
		bot_car.global_position = Vector3(0.0, RlConstants.CAR_HOVER_CENTER_Y, 10.0)
		var bot_mesh: MeshInstance3D = bot_car.find_child("BodyMesh", true, false) as MeshInstance3D
		if bot_mesh:
			var mat := StandardMaterial3D.new()
			mat.albedo_color = Color(0.95, 0.45, 0.15)
			bot_mesh.material_override = mat
		var ai := RocketBotAI.new()
		ai.name = "RocketBotAI"
		ai.slot_index = 1
		bot_car.add_child(ai)
		ai_manager.register_bot(1, ai)
	if ball:
		ball.global_position = Vector3(0.0, RlConstants.BALL_RADIUS + 0.1, 0.0)


func _process(delta: float) -> void:
	if human_car:
		if human_car.consume_ball_cam_toggle():
			_ball_cam = not _ball_cam
			if camera_rig:
				camera_rig.is_ball_cam = _ball_cam

	var cars: Array = [human_car, bot_car]
	ai_manager.think_all(cars, ball, delta)
