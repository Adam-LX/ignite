/**
 * Stałe fizyki Rocket League w jednostkach SI (m, m/s, m/s², rad/s²).
 * Źródła: RLBot wiki useful-game-values, smish ground_control, jumping-physics.
 */

/** Grawitacja: 650 uu/s² = 6.5 m/s² */
export const WORLD_GRAVITY = -6.5;

export const RL_CAR = {
	/** Masa — Rapier (nie wpływa na przyspieszenia kinematyczne RL). */
	mass: 180,
	/** Max prędkość auta: lekko ponad RL — więcej „pędu” w odczuciu. */
	maxSpeed: 24.5,
	/** Max bez boosta — wyżej = mniej „ściany” przed boostem. */
	throttleMaxSpeed: 15.6,
	/** Cofanie */
	reverseMaxSpeed: 13,
	/** Boost — ostrzejszy punch. */
	boostAccel: 11.2,
	/** Powietrze — RLBot wiki + lekki bump feel. */
	airBoostAccel: 1180,
	/** Hamulec: 3500 uu/s² = 35 m/s² */
	brakeAccel: 38,
	/** Coast — mniej „kleju” po puszczeniu gazu. */
	coastDecel: 3.6,
	/** Skala A/D na klawiaturze (±1 → analog); 1.0 = pełny yaw jak pad. */
	keyboardYawScale: 1,
	/** Obrót w miejscu przy niskiej prędkości (rad/s przy pełnym skręcie). */
	groundTurnInPlace: 2.35,
	/** Pivot / skręt — mocniejsza redukcja przy piłce (celowanie w hit). */
	steerNearBallMul: 0.72,
	steerNearBallRadius: 14,
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
	jumpImpulse: 3.05,
	doubleJumpImpulse: 3.05,
	/** Hold bonus: 1460 uu/s² przez 0.2 s */
	jumpHoldAccel: 15.5,
	jumpHoldMax: 0.2,
	/** Okno dodge: 1.25–1.45 s */
	dodgeWindow: 1.35,
	/** RocketSim CarConfig default — |pitch|+|yaw|+|roll| */
	dodgeDeadzone: 0.5,
	/**
	 * KBM aerial QoL: flip tylko gdy kierunek „świeży” (≤s) względem 2. skoku.
	 * Trzymanie W pod aerial → double jump; tap W/A/S/D + jump → dodge (jak notatki).
	 * Pad: fresh window i tak łapie szybki flick sticka.
	 */
	dodgeFreshStickSec: 0.2,
	/** Dodge liniowy 500 uu/s (RocketSim FLIP_INITIAL_VEL_SCALE) */
	flipImpulse: 5.0,
	/** Backward dodge base ~533 uu/s */
	flipBackImpulse: 5.333,
	/** RocketSim FLIP_TORQUE_TIME */
	flipDuration: 0.65,
	flipGravityOffDuration: 0.65,
	/** RocketSim FLIP_Z_DAMP_START / END */
	flipVertDampStart: 0.15,
	flipVertDampEnd: 0.21,
	/** RocketSim: z *= (1 - FLIP_Z_DAMP_120) per 120 Hz tick */
	flipVertDampMul: 0.65,
	/** Pierwsze 5 ticków bez flip cancel (Rocket Science / post-NoFlip patch) */
	flipNoCancelTime: 5 / 120,
	/** RocketSim FLIP_PITCHLOCK_EXTRA_TIME */
	flipPitchLockExtra: 0.3,
	/** Po neutralnym double jump: krótki lock sub-deadzone. */
	neutralJumpLockTime: 0.15,
	physicsTickHz: 120,
	flipVisualDuration: 0.65,
	/** RocketSim CAR_MAX_ANG_SPEED */
	airMaxAngVel: 5.5,
	flipMaxAngVel: 5.5,
	/** Backflip: większa translacja, mniejszy spin „w miejscu”. */
	backflipImpulseMul: 16 / 15,
	backflipPitchTorqueMul: 1,
	/** Sticky po skoku — RL sticky forces. */
	stickyForce: 1.9,
	stickyDuration: 2 / 120,
	/**
	 * Air control — RocketSim CAR_AIR_CONTROL_TORQUE × CAR_TORQUE_SCALE
	 * (≈ rad/s² przy naszym modelu torque = accel * mass).
	 */
	yawAngAccel: 9.1,
	/** Yaw na ziemi — niżej niż air; mniej „snap” przy celowaniu w power shot. */
	groundYawAccel: 7.2,
	/** Lekko niżej — KBM W w powietrzu mniej „plantuje” nos (klip Meridian). */
	pitchAngAccel: 10.8,
	rollAngAccel: 38.3,
	/** RocketSim CAR_AIR_CONTROL_DAMPING × CAR_TORQUE_SCALE */
	airPitchDamp: 2.88,
	airYawDamp: 1.92,
	airRollDamp: 4.79,
	/** Retencja prędkości normalnej przy lądowaniu (1 = twardo). */
	landingNormalRetain: 0.62,
	/** Retencja spinu po dotknięciu kół. */
	landingSpinRetain: 0.82,
	airReverseAccel: 0.333_34,
	/** Tarcie boczne — wyżej = mniej rwanej jazdy / nadsteru przy piłce. */
	lateralGrip: 11.4,
	/** Powerslide — słabsze trzymanie boku */
	driftGrip: 1.05,
	/** Mnożnik yaw przy powerslide (jak w RL — ostry slide turn). */
	driftSteerMul: 1.42,
	/** Po puszczeniu Shift — blend grip przez ~ten czas (s). */
	gripExitBlendSec: 0.12,
	/** Snap velocity→forward — za wysoki zabija dynamikę / feint. */
	groundAlign: 2.65,
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
	wallMaxSpeed: 24.5,
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
	airBoostLinearDampMul: 0.45,
	linearDamp: 0.015,
	angularDamp: 0.12,
	airLinearDamp: 0.008,
	airAngularDamp: 0.04,
} as const;

/** Raycast hover — 4 wirtualne sprężyny (Rocket League style). */
export const RL_HOVER = {
	suspensionRestLength: 0.34,
	suspensionMaxLength: 0.55,
	suspensionStiffness: 2400,
	suspensionDamping: 120,
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
	/** Tarcie piłki na murawie — niżej = mniej „kamienia”, dłuższy rolling. */
	groundFriction: 0.36,
	/** Korekta tunelu — ułamek prędkości po odbiciu (żywsza sprężystość). */
	floorBounceRetain: 0.72,
	wallBounceRetain: 0.68,
	ceilingBounceRetain: 0.58,
	/** Max 6000 uu/s = 60 m/s */
	maxSpeed: 60,
	/** Sliding friction na murawie — nie „hamulec ręczny” w 1–2 s. */
	groundSlideDecel: 1.45,
	/** Rolling poniżej ~565 uu/s — wolniejszy zanik = dłuższe toczenie. */
	groundRollDecel: 0.04,
	airLinearDamp: 0.025,
	airAngularDamp: 0.08,
	groundLinearDamp: 0.035,
	groundAngularDamp: 0.08,
	/** Max spin ~60 RPM = 2π rad/s */
	maxSpinRad: Math.PI * 2,
	minHitSpeed: 0.25,
	/** Soft dribble / rolling — rejestruj wolne kontakty (smish feel). */
	minApproachSpeed: 0.45,
	/** Psyonix extra impulse — RocketSim / smish ball_simulation_3. */
	psyonixVertScale: 0.35,
	psyonixForwardRetain: 0.72,
	psyonixMaxRelSpeedUu: 4600,
	extraForceScale: 1.1,
	/** Soft touch: poniżej tego |Δv| (uu/s) tłumi extraForce (dribble). */
	softTouchSpeedUu: 1100,
	softTouchScaleMin: 0.52,
	boostHitMul: 1.1,
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

/**
 * Kamera — parity z default RL (FOV 110, dist 270 uu, height 100 uu, angle −3).
 * 1 uu = 1 cm → dist 2.7 m, height 1.0 m. Lekki bump dystansu pod nasze meshe.
 */
export const RL_CAMERA = {
	distance: 3.35,
	/**
	 * RL default = 1.0 m. Trzymamy lekki bump pod nasze GLB, ale 1.48 dawało
	 * top-down / „orbitę menu” na chase (klipy F9). 1.22 ≈ więcej horyzontu.
	 */
	height: 1.22,
	/** RL ≈ −3°; −5° + wysokość 1.48 = za dużo murawy w środku kadru. */
	angleDeg: -3.5,
	stiffness: 0.5,
	lookAhead: 1.15,
	lookAtCarOffsetY: 0.42,
	/** 100° hFOV @ 16:9 ≈ RL-feel bez baryłki na ultrawide. */
	horizontalFov: 100,
	horizontalFovBoost: 104,
	swivelSpeed: 5.0,
	maxSpeedStretch: 0.22,
} as const;
