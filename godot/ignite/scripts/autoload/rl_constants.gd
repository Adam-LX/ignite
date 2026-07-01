extends Node
## Stałe fizyki Rocket League — SI (m, m/s, N). Port 1:1 z src/util/rlConstants.ts

const WORLD_GRAVITY: float = 6.5

const CAR_MASS: float = 180.0
const CAR_MAX_SPEED: float = 23.0
const CAR_THROTTLE_MAX_SPEED: float = 14.1
const CAR_REVERSE_MAX_SPEED: float = 12.0
const CAR_BOOST_ACCEL: float = 9.91667
const CAR_YAW_ANG_ACCEL: float = 9.11
const CAR_BOOST_DRAIN: float = 0.33
const CAR_BOOST_REGEN_GROUND: float = 0.25
const CAR_BOOST_REGEN_AIR: float = 0.08
const CAR_JUMP_IMPULSE_MUL: float = 7.5
const CAR_LATERAL_GRIP: float = 12.0
const CAR_DRIFT_GRIP: float = 2.5
const CAR_GROUND_ALIGN: float = 8.0
const CAR_HITBOX_HALF_X: float = 0.42
const CAR_HITBOX_HALF_Y: float = 0.18
const CAR_HITBOX_HALF_Z: float = 0.59
## Pełny rozmiar Octane (X=szerokość, Y=wysokość, Z=długość) — auto leży płasko na Y.
const CAR_HITBOX_SIZE: Vector3 = Vector3(0.84, 0.36, 1.18)
const CAR_LINEAR_DAMP: float = 0.02
const CAR_ANGULAR_DAMP: float = 0.15
const CAR_AIR_LINEAR_DAMP: float = 0.01
const CAR_AIR_ANGULAR_DAMP_ACTIVE: float = 0.0
const CAR_AIR_ANGULAR_DAMP_IDLE: float = 10.0
const CAR_WALL_NORMAL_FLAT_THRESHOLD: float = 0.9
const CAR_AIR_THROTTLE_ACCEL: float = 0.66667
const CAR_AIR_REVERSE_ACCEL: float = 0.33334

const HOVER_SUSPENSION_REST: float = 0.34
const HOVER_SUSPENSION_MAX: float = 0.55
const HOVER_STIFFNESS: float = 2400.0
const HOVER_DAMPING: float = 155.0
const HOVER_GROUNDED_MIN_WHEELS: int = 2
const HOVER_WALL_STICK_ACCEL: float = 3.25

const AERIAL_PITCH_MUL: float = 0.45
const AERIAL_YAW_MUL: float = 0.45
const AERIAL_ROLL_MUL: float = 0.35
const AERIAL_VERTICAL_ROLL_BOOST: float = 1.35
const VERTICAL_STAND_THRESHOLD: float = 0.85
const UPRIGHT_DRIVE_THRESHOLD: float = 0.7
const TURTLE_UP_THRESHOLD: float = -0.2

const BALL_RADIUS: float = 0.9125
const BALL_MASS: float = 0.3
const BALL_RESTITUTION: float = 0.6
const BALL_MAX_SPEED: float = 60.0

const CAM_DISTANCE: float = 2.7
const CAM_HEIGHT: float = 1.52
const CAM_ANGLE_DEG: float = -8.5
const CAM_STIFFNESS: float = 0.45
const CAM_LOOK_AHEAD: float = 1.35
const CAM_LOOK_AT_OFFSET_Y: float = 0.48
const CAM_FOV: float = 75.0

const ARENA_HALF_WIDTH: float = 40.0
const ARENA_HALF_LENGTH: float = 60.0
const WALL_MARGIN: float = 3.0

const UU_PER_M: float = 100.0

## Dolne narożniki hitboxa (Y = dół pudełka, promienie w -Y). Godot: -Z = przód.
const CORNER_OFFSETS: Array[Vector3] = [
	Vector3(CAR_HITBOX_HALF_X * 0.92, -CAR_HITBOX_HALF_Y, -CAR_HITBOX_HALF_Z * 0.92),
	Vector3(-CAR_HITBOX_HALF_X * 0.92, -CAR_HITBOX_HALF_Y, -CAR_HITBOX_HALF_Z * 0.92),
	Vector3(CAR_HITBOX_HALF_X * 0.92, -CAR_HITBOX_HALF_Y, CAR_HITBOX_HALF_Z * 0.92),
	Vector3(-CAR_HITBOX_HALF_X * 0.92, -CAR_HITBOX_HALF_Y, CAR_HITBOX_HALF_Z * 0.92),
]

## Wysokość środka auta nad płaszczyzną murawy (y=0) w stanie hover.
const CAR_HOVER_CENTER_Y: float = HOVER_SUSPENSION_REST + CAR_HITBOX_HALF_Y
