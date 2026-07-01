extends RigidBody3D
## Piłka — port RL_BALL + proste tarcie

func _ready() -> void:
	mass = RlConstants.BALL_MASS
	continuous_cd = true
	collision_layer = 4
	collision_mask = 1 | 2
	linear_damp = 0.03
	angular_damp = 0.1

	var mat := PhysicsMaterial.new()
	mat.bounce = RlConstants.BALL_RESTITUTION
	mat.friction = 0.4
	physics_material_override = mat


func _physics_process(_delta: float) -> void:
	var v: Vector3 = linear_velocity
	if v.length_squared() > RlConstants.BALL_MAX_SPEED * RlConstants.BALL_MAX_SPEED:
		linear_velocity = v.normalized() * RlConstants.BALL_MAX_SPEED
