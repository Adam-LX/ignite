/**
 * Stałe fizyki Rocket League w jednostkach SI (m, m/s, m/s², rad/s²).
 * Źródła: RLBot wiki useful-game-values, smish ground_control, jumping-physics.
 */

/** Grawitacja: 650 uu/s² = 6.5 m/s² */
export const WORLD_GRAVITY = -6.5;

export const RL_CAR = {
	/** Masa — Rapier (nie wpływa na przyspieszenia kinematyczne RL). */
	mass: 180,
	/** Max prędkość auta: RL Soccar 2300 uu/s = 23 m/s. */
	maxSpeed: 23.0,
	/** Max bez boosta — 1410 uu/s. */
	throttleMaxSpeed: 14.1,
	/** Cofanie */
	reverseMaxSpeed: 13,
	/** Boost — 991.67 uu/s². */
	boostAccel: 9.92,
	/** Powietrze — RLBot wiki + lekki bump feel. */
	airBoostAccel: 1180,
	/** Hamulec: 3500 uu/s² = 35 m/s² */
	brakeAccel: 38,
	/** Coast — 350 uu/s². */
	coastDecel: 3.5,
	/** Skala A/D na klawiaturze (±1 → analog); 1.0 = pełny yaw jak pad. */
	keyboardYawScale: 1,
	/** Obrót w miejscu przy niskiej prędkości (rad/s przy pełnym skręcie). */
	groundTurnInPlace: 2.55,
	/** Pivot / skręt — mocniejsza redukcja przy piłce (celowanie w hit). */
	steerNearBallMul: 0.82,
	steerNearBallRadius: 10,
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
	/** Skok: 291.667 uu/s (RocketSim JUMP_IMMEDIATE_FORCE) */
	jumpImpulse: 2.917,
	doubleJumpImpulse: 2.917,
	/** Hold: 1458.33 uu/s² przez 0.2 s (JUMP_ACCEL) */
	jumpHoldAccel: 14.583,
	jumpHoldMax: 0.2,
	/** RocketSim JUMP_MIN_TIME — hold force ×0.62 przed tym. */
	jumpHoldMinTime: 0.025,
	jumpHoldPreMinScale: 0.62,
	/** Okno dodge: DOUBLEJUMP_MAX_DELAY */
	dodgeWindow: 1.25,
	/** RocketSim CarConfig default — |pitch|+|yaw|+|roll| */
	dodgeDeadzone: 0.5,
	/** @deprecated Nieużywane — RL dodge nie wymaga świeżego sticka (klip 01-08-24). */
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
	/**
	 * Flip reset (clean-room): koła/hood na piłce w powietrzu przez dwell
	 * przywraca dodge (canSecondJump). Nie mylić z bannerem „FLIP RESET!”.
	 */
	flipResetDwellSec: 0.05,
	flipResetCooldownSec: 0.4,
	/** ballRel·carUp ≤ −to → piłka pod autem (wheels-on-ball). */
	flipResetBallBelowDot: 0.55,
	/** Extra luz dystansu ponad hitboxHalfY + radius. */
	flipResetDistSlack: 0.14,
	/**
	 * Wavedash: flip + koła w murawę wcześnie → cancel + burst tangentialny.
	 * RocketSim-style cancel→grip, nie osobna mechanika z RL binarki.
	 */
	waveDashMinFlipElapsed: 0.02,
	waveDashMaxFlipElapsed: 0.28,
	waveDashSpeedBoost: 2.65,
	waveDashMinCompressWheels: 2,
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
	 * (pitch=130, yaw=95, roll=400) × ≈0.09587.
	 */
	yawAngAccel: 9.1,
	pitchAngAccel: 12.45,
	rollAngAccel: 38.3,
	/** RocketSim CAR_AIR_CONTROL_DAMPING × CAR_TORQUE_SCALE */
	airPitchDamp: 2.88,
	airYawDamp: 1.92,
	airRollDamp: 4.79,
	/** Retencja prędkości normalnej przy lądowaniu (1 = twardo). */
	landingNormalRetain: 0.62,
	/** Retencja spinu po dotknięciu kół. */
	landingSpinRetain: 0.88,
	airReverseAccel: 0.333_34,
	/** Tarcie boczne — wyżej = mniej rwanej jazdy / nadsteru przy piłce. */
	lateralGrip: 10.2,
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
	wallMaxSpeed: 23.0,
	/** Szybki follow łuku quarter-pipe (za wolny = auto płaskie, potem flip). */
	wallAlignSlerp: 0.42,
	/** Wejście ramp→wall: wyższy retain = mniej popu Y (entry_smooth). */
	rampEntryNormalRetain: 0.94,
	/** Max prędkość oddalania od ściany (m/s) — anty-launch z bandy. */
	wallRideSeparationMax: 2.8,
	/** Prędkość referencyjna dla mnożnika stick (m/s). */
	wallSpeedStickRef: 22,
	/** Extra stick na suficie (n.y < 0). */
	wallCeilingStickMul: 1.45,
	/** Po skoku ze ściany — ignoruj stick (s), żeby jump nie ginął. */
	wallJumpDetachSec: 0.45,
	/** Extra push wzdłuż normalnej ściany przy wall jump (m/s) — drugi skok nie klei. */
	wallJumpNormalBoost: 2.4,
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
	wallStickAccel: 2.95,
	/** Histereza kontaktu ze ścianą — dłuższa na łukach narożników / cove. */
	wallContactGrace: 16 / 120,
	/** Mnożnik docisku na bandę (anty-launch) — niższy = płynniejszy zjazd. */
	wallRideStickMul: 1.92,
} as const;

export const RL_BALL = {
	/** Promień piłki RL: 91.25 uu = 0.9125 m */
	radius: 0.9125,
	mass: 0.3,
	/** CR piłki — smish / rl_ball_sym / RocketGoal (0.6 na wszystkich powierzchniach). */
	restitution: 0.6,
	/** Tarcie Rapier — wspomaga rolling bez smish na miękkim kontakcie. */
	groundFriction: 0.22,
	/**
	 * Retain prędkości przy twardym clamp areny (enforceBallArenaBounds).
	 * = CR; wcześniej floor 0.72 dawało kangura (~peak 1.94 zamiast ~1.66 z 3 m).
	 */
	floorBounceRetain: 0.6,
	wallBounceRetain: 0.6,
	ceilingBounceRetain: 0.6,
	/** Max 6000 uu/s = 60 m/s */
	maxSpeed: 60,
	/**
	 * Sliding na murawie — public ~230 uu/s²; lekko niżej przez Rapier friction.
	 */
	groundSlideDecel: 1.55,
	/** Rolling poniżej ~565 uu/s — wolniejszy zanik = dłuższe toczenie. */
	groundRollDecel: 0.035,
	/**
	 * RL air drag (rl_ball_sym): v *= (1 + DRAG)^dt, DRAG = −0.0305.
	 * Rapier linearDamping trzymamy nisko — główny drag jest tu.
	 */
	airDrag: -0.0305,
	airLinearDamp: 0.01,
	airAngularDamp: 0.055,
	/**
	 * Magnus ω×v — rl_ball_sym NIE ma Magnusa w locie (tylko drag+g).
	 * 0 = clean-room parity; spin działa przez smish bounce.
	 */
	magnusScale: 0,
	groundLinearDamp: 0.025,
	groundAngularDamp: 0.05,
	/** Max spin ~6 rad/s (~57 RPM) — publiczne limity RL. */
	maxSpinRad: Math.PI * 2,
	minHitSpeed: 0.25,
	/** Soft dribble / rolling — rejestruj wolne kontakty (smish feel). */
	minApproachSpeed: 0.55,
	/** Psyonix extra impulse — RocketSim / smish ball_simulation_3. */
	psyonixVertScale: 0.35,
	psyonixForwardRetain: 0.65,
	psyonixMaxRelSpeedUu: 4600,
	/**
	 * Globalna skala Psyonix — lekko >1, bo Rapier+hover daje słabszy
	 * „inelastic punch” niż Bullet w RL (smish / RocketSim).
	 */
	extraForceScale: 1.16,
	/** Soft touch: poniżej tego |Δv| (uu/s) tłumi extraForce (dribble). */
	softTouchSpeedUu: 1000,
	softTouchScaleMin: 0.42,
	boostHitMul: 1.12,
	flipHitMul: 1.42,
	/**
	 * Domknięcie skali do closing (m/s) — niższy dzielnik = mocniejsze twarde hity
	 * (w RL hard powershot leci ~100+ km/h).
	 */
	closingScaleDiv: 4.0,
	closingScaleMin: 0.5,
	/**
	 * Udział „Bullet-like” transferu closing→piłka przy twardych hitach
	 * (hover cars rzadko dostają pełny impuls Rapiera).
	 */
	hardHitInelasticGain: 0.4,
	/** Loft z geometrii: piłka poniżej środka auta (rząd „dół” hitboxa). */
	groundLoftFromBelow: 0.32,
	/** Loft z pitchu auta (flip / nose-up). */
	pitchLoftScale: 0.5,
	/** Bezpiecznik pionu po uderzeniu (aerial / boost). */
	maxHitVertSpeed: 14.5,
	maxBoostHitVertSpeed: 18.0,
	/** I = moiScale · m · r² (rl_ball_sym). */
	moiScale: 0.4,
	/** Coulomb μ przy odbiciu — rl_ball_sym MU = 2. */
	bounceFrictionMu: 2.0,
	/** Cooldown Psyonix impulse na auto (s) — bez spamu przy overlap/dribble. */
	hitCooldownSec: 6 / 120,
	/** Soft/hood carry — dłuższy cooldown przy niskim |Δv| (stabilniejszy dribble). */
	softHitCooldownSec: 10 / 120,
	/** Hood: localY / (r+halfY) w tym zakresie → mniej loftu, więcej carry. */
	hoodCarryLocalYMax: 0.72,
	hoodCarryLoftMul: 0.55,
	/**
	 * Po smish: jeśli |vy| < próg i piłka na murawie — wytłum mikrokangura.
	 * NIE w resolveSmish (multi-collider zjadał rebound).
	 */
	groundSettleVy: 0.45,
} as const;

/**
 * Kamera — parity z default RL (FOV 110, dist 270 uu, height 90 uu, angle −4).
 * 1 uu = 1 cm → dist 2.7 m, height 0.9 m.
 */
export const RL_CAMERA = {
	/**
	 * Baza zbliżona do typowych ustawień pro (publiczne: ~270/90 UU ≈ 2.7/0.9 m).
	 * Inspiracja feelu — własne jednostki Ignite, nie kopia kodu RL.
	 * Height 90: majority RLCS 2026 (Vatira / Jack / BeastMode split).
	 */
	distance: 2.7,
	/** Pro majority ~90 UU → 0.9 m (100 UU nadal w zakresie kontraktu). */
	height: 0.9,
	/** Typowy pro angle −3…−5°. */
	angleDeg: -4,
	/**
	 * Stiffness 0–1 (Liquipedia / pro guides 2026):
	 * niższy = większy zoom-out przy max speed.
	 * ~90% pro: **0.35** — czytelny stretch przy SS.
	 */
	stiffness: 0.35,
	lookAhead: 1.0,
	lookAtCarOffsetY: 0.42,
	/** Prozy ~110 FOV (guides 2026). */
	horizontalFov: 110,
	horizontalFovBoost: 114,
	/** Ball Cam look swivel — pro ~4–7, tip 7.0. */
	swivelSpeed: 7.0,
	/**
	 * Max dodatkowy dystans przy speed=1 i stiffness=0 (m).
	 * Publiczna formuła Rocket Science: (1−stiffness)×114.7 UU ≈ ×1.147 m.
	 * Przy stiffness=0.35 → stretch ≈ 0.75 m.
	 */
	maxSpeedStretch: 1.147,
	/** Transition Ball↔Free — RL pro tip 1.3 (zakres 1.0–1.6). */
	transitionSpeed: 1.3,
} as const;
