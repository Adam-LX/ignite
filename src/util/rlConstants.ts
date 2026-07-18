/**
 * Stałe fizyki Rocket League w jednostkach SI (m, m/s, m/s², rad/s²).
 * Źródła: RLBot wiki useful-game-values, smish ground_control, jumping-physics.
 */

/** Grawitacja: 650 uu/s² = 6.5 m/s² */
export const WORLD_GRAVITY = -6.5;

export const RL_CAR = {
	/** Masa — Rapier (nie wpływa na przyspieszenia kinematyczne RL). */
	mass: 180,
	/** Max prędkość auta: 2300 uu/s = 23 m/s */
	maxSpeed: 23,
	/** Max bez boosta (throttle): 1410 uu/s = 14.1 m/s */
	throttleMaxSpeed: 14.1,
	/** Cofanie ~1200 uu/s */
	reverseMaxSpeed: 12,
	/** Boost: 991.667 uu/s² = 9.917 m/s² (dodatkowo do throttle) */
	boostAccel: 9.916_67,
	/** Powietrze — RLBot wiki */
	airBoostAccel: 1058.333,
	/** Hamulec: 3500 uu/s² = 35 m/s² */
	brakeAccel: 35,
	/** Coast: 525 uu/s² = 5.25 m/s² */
	coastDecel: 5.25,
	/** Maks. przysp. kątowe (rad/s²) — RLBot wiki */
	yawAngAccel: 9.11,
	pitchAngAccel: 12.46,
	rollAngAccel: 24.5,
	/** Skala A/D na klawiaturze (±1 → analog); gamepad bez zmian. */
	keyboardYawScale: 0.72,
	/** Obrót w miejscu przy niskiej prędkości (rad/s przy pełnym skręcie). */
	groundTurnInPlace: 2.5,
	/** Pivot / skręt — redukcja przy piłce */
	steerNearBallMul: 0.85,
	steerNearBallRadius: 8,
	/** Boost tank — RL Soccar: start/respawn 33/100, brak passive regen. */
	boostDrain: 0.33,
	/** Spawn / reset kickoff (RL: 33). */
	boostSpawn: 0.33,
	/**
	 * Passive regen rates — stosowane tylko gdy `boostRegenMul > 1`
	 * (Rush / Overcharge / Lab). Core ma mul=1 → zero regen.
	 */
	boostRegenGround: 0.25,
	boostRegenAir: 0.08,
	/** Skok: 291.667 uu/s ≈ 2.917 m/s (impuls prędkości w górę) */
	jumpImpulse: 2.916_67,
	doubleJumpImpulse: 2.916_67,
	/** Hold bonus: 1460 uu/s² przez 0.2 s */
	jumpHoldAccel: 14.6,
	jumpHoldMax: 0.2,
	/** Okno dodge: 1.25–1.45 s */
	dodgeWindow: 1.35,
	/** Suma |throttle|+|yaw| — próg flipa (RL dodge deadzone) */
	dodgeDeadzone: 0.2,
	/** Dodge liniowy ~500 uu/s */
	flipImpulse: 5.0,
	/** Backward dodge base ~533 uu/s */
	flipBackImpulse: 5.33,
	/** Czas torque flipa (RocketSim FLIP_TORQUE_TIME) */
	flipDuration: 0.65,
	flipGravityOffDuration: 0.65,
	/** Po 0.15 s dodge: redukcja prędkości w dół o 35% / tick @ 120 Hz */
	flipVertDampStart: 0.25,
	/** W górę: damp przez 8 ticków @ 120 Hz (Rocket Science #14) */
	flipVertDampEnd: 0.26,
	flipVertDampMul: 0.7,
	/** Pierwsze 5 ticków bez flip cancel (Rocket Science / post-NoFlip patch) */
	flipNoCancelTime: 5 / 120,
	/** Po flipie: blokada pitch air control (RocketSim FLIP_PITCHLOCK_EXTRA_TIME) */
	flipPitchLockExtra: 0.3,
	/** Po neutralnym double jump: ignoruj sub-deadzone input + trzymaj tor prosty. */
	neutralJumpLockTime: 0.22,
	physicsTickHz: 120,
	flipVisualDuration: 0.5,
	/** RL: 5.5 rad/s w powietrzu, 7.3 podczas dodge */
	airMaxAngVel: 5.5,
	flipMaxAngVel: 7.3,
	/** Backflip: większa translacja, mniejszy spin „w miejscu”. */
	backflipImpulseMul: 1.14,
	backflipPitchTorqueMul: 0.82,
	/** Sticky po skoku: 325 uu/s² przez 3 ticki @ 120 Hz */
	stickyForce: 3.25,
	stickyDuration: 3 / 120,
	/** Tłumienie spinu w powietrzu (RocketSim CAR_AIR_CONTROL_DAMPING, skala SI). */
	airPitchDamp: 5.0,
	airYawDamp: 3.0,
	airRollDamp: 9.2,
	/** Retencja prędkości normalnej przy lądowaniu (1 = twardo). */
	landingNormalRetain: 0.38,
	/** Retencja spinu po dotknięciu kół. */
	landingSpinRetain: 0.72,
	airReverseAccel: 0.333_34,
	/** Tarcie boczne na murawie (kinematyczne, bez powerslide) */
	lateralGrip: 14.5,
	/** Powerslide — słabsze trzymanie boku */
	driftGrip: 1.55,
	/** Mnożnik yaw przy powerslide (jak w RL — ostry slide turn). */
	driftSteerMul: 1.34,
	/** Po puszczeniu Shift — blend grip przez ~ten czas (s). */
	gripExitBlendSec: 0.14,
	groundAlign: 7.2,
	/** Rapier friction auta — niskie; jazda jest kinematyczna (nie po tarciu silnika). */
	carColliderFriction: 0.28,
	/** Hitbox Octane (m) — fizyka niezależna od szerokości wizualnej. */
	hitboxHalfX: 0.42,
	hitboxHalfY: 0.18,
	hitboxHalfZ: 0.59,
	/** Próg normalnej Y — rampa/ściana */
	wallNormalFlatThreshold: 0.9,
	/** Docisk na ścianę: 325 uu/s² */
	wallDownforce: 2.6,
	wallMaxSpeed: 23,
	/** Szybki follow łuku quarter-pipe (za wolny = auto płaskie, potem flip). */
	wallAlignSlerp: 0.34,
	/** Max prędkość oddalania od ściany (m/s) — anty-launch z bandy. */
	wallRideSeparationMax: 2.8,
	/** Prędkość referencyjna dla mnożnika stick (m/s). */
	wallSpeedStickRef: 22,
	/** Extra stick na suficie (n.y < 0). */
	wallCeilingStickMul: 1.45,
	/** Po skoku ze ściany — ignoruj stick (s), żeby jump nie ginął. */
	wallJumpDetachSec: 0.28,
	/** Cooldown pierwszego skoku (s) — 1.5s kleił auto na wall. */
	jumpGroundCooldown: 0.14,
	/** Rozłożenie impulsu dodge na N ticków @ 120 Hz. */
	flipImpulseSpreadTicks: 3,
	/** Mnożnik linearDamp w powietrzu przy boost. */
	airBoostLinearDampMul: 0.5,
	linearDamp: 0.02,
	angularDamp: 0.15,
	airLinearDamp: 0.01,
	airAngularDamp: 0.05,
} as const;

/** Raycast hover — 4 wirtualne sprężyny (Rocket League style). */
export const RL_HOVER = {
	suspensionRestLength: 0.34,
	suspensionMaxLength: 0.55,
	suspensionStiffness: 2400,
	suspensionDamping: 155,
	groundedMinWheels: 2,
	/** Histereza utraty kontaktu — ~4 ticki @ 120 Hz (bez migotania boosta / skoku). */
	groundReleaseGrace: 4 / 120,
	/** Wygaszenie spinu w powietrzu gdy brak inputu (na tick @ 120 Hz). */
	airSpinDamp: 0.88,
	/** Siła docisku przy jeździe po ścianie (N). */
	wallStickAccel: 2.75,
	/** Histereza kontaktu ze ścianą — dłuższa na łukach narożników / cove. */
	wallContactGrace: 16 / 120,
	/** Mnożnik docisku na bandę (anty-launch) — niższy = płynniejszy zjazd. */
	wallRideStickMul: 1.85,
} as const;

export const RL_BALL = {
	/** Promień piłki RL: 91.25 uu = 0.9125 m */
	radius: 0.9125,
	mass: 0.3,
	/** CR piłki — smish / rl_ball_sym / RocketGoal (≈0.6). */
	restitution: 0.6,
	/** Tarcie piłki na murawie — grip bez „klejenia” przy rolling goal. */
	groundFriction: 0.48,
	/** Korekta tunelu — ułamek prędkości po odbiciu (murawa RL, żywsza hang). */
	floorBounceRetain: 0.6,
	wallBounceRetain: 0.62,
	ceilingBounceRetain: 0.52,
	/** Max 6000 uu/s = 60 m/s */
	maxSpeed: 60,
	/** Sliding friction na murawie — nie „hamulec ręczny” w 1–2 s. */
	groundSlideDecel: 2.1,
	/** Rolling poniżej ~565 uu/s — wolniejszy zanik = dłuższe toczenie. */
	groundRollDecel: 0.065,
	airLinearDamp: 0.03,
	airAngularDamp: 0.1,
	groundLinearDamp: 0.05,
	groundAngularDamp: 0.1,
	/** Max spin ~60 RPM = 2π rad/s */
	maxSpinRad: Math.PI * 2,
	minHitSpeed: 0.25,
	/** Soft dribble / rolling — rejestruj wolne kontakty (smish feel). */
	minApproachSpeed: 0.55,
	/** Psyonix extra impulse — RocketSim / smish ball_simulation_3. */
	psyonixVertScale: 0.35,
	psyonixForwardRetain: 0.68,
	psyonixMaxRelSpeedUu: 4600,
	extraForceScale: 1.0,
	/** Soft touch: poniżej tego |Δv| (uu/s) tłumi extraForce (dribble). */
	softTouchSpeedUu: 900,
	softTouchScaleMin: 0.45,
	boostHitMul: 1.06,
	flipHitMul: 1.28,
	/** Loft z geometrii: piłka poniżej środka auta (rząd „dół” hitboxa). */
	groundLoftFromBelow: 0.34,
	/** Loft z pitchu auta (flip / nose-up). */
	pitchLoftScale: 0.48,
	/** Bezpiecznik pionu po uderzeniu (aerial / boost). */
	maxHitVertSpeed: 13,
	maxBoostHitVertSpeed: 16,
	/** I = moiScale · m · r² (rl_ball_sym). */
	moiScale: 0.4,
	/** Coulomb μ przy odbiciu — smish; lekko niżej = żywsze bounce. */
	bounceFrictionMu: 1.85,
} as const;

/** Kamera RL — chase za autem, auto z zapasem od dolnej krawędzi kadru. */
export const RL_CAMERA = {
	distance: 5.8,
	height: 1.85,
	angleDeg: -8.5,
	stiffness: 0.45,
	/** Metry przed autem — mniejsze = więcej auta w kadrze. */
	lookAhead: 1.55,
	lookAtCarOffsetY: 0.72,
	horizontalFov: 92,
	horizontalFovBoost: 98,
	swivelSpeed: 4.0,
	maxSpeedStretch: 0.35,
} as const;
