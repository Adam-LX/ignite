import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import {
	HOVER_DEBUG_RAYS,
	HOVER_FORCE_MAX,
	HOVER_SAFE_MODE,
	HOVER_TELEMETRY_EVERY_STEPS,
} from "../debug/config";
import GameObject from "../GameObject";
import type Scene from "../Scene";
import type { RigidBodyData } from "../types";
import type { ControlInput } from "../util/ControlInput";
import { RL_CAR, RL_HOVER, WORLD_GRAVITY } from "../util/rlConstants";
import {
	carHorizontalForwardFromQuat,
	carHorizontalRightFromForward,
	clampSpeedMps,
	mpsToUu,
	rlAirBoostAccelUu,
	rlAirThrottleAccelUu,
	rlDodgeImpulseComponentsMps,
	rlFlipCancelPitchScale,
	rlFlipRelTorque,
	rlGroundDriveAccelUu,
	rlTargetYawRate,
	uuAccelToMps2,
} from "../util/rlPhysics";
import {
	SimulatedControlInput,
	type SimulatedInput,
} from "../util/SimulatedInput";
import {
	getTraitsForBodyStyle,
	type CarBodyTraits,
	pivotDodgeDeadzone,
} from "../meta/carBodyTraits";
import {
	getMeridianSphere,
	isMeridianArenaActive,
	meridianSurfaceNormalAt,
} from "../visual/meridianArena";
import {
	type SuspensionRayDebug,
	SuspensionVisualizer,
} from "./SuspensionVisualizer";

const _rayDebugScratch: SuspensionRayDebug[] = [
	{ origin: new THREE.Vector3(), end: new THREE.Vector3(), hit: false },
	{ origin: new THREE.Vector3(), end: new THREE.Vector3(), hit: false },
	{ origin: new THREE.Vector3(), end: new THREE.Vector3(), hit: false },
	{ origin: new THREE.Vector3(), end: new THREE.Vector3(), hit: false },
];

type WheelHit = {
	hit: boolean;
	/** Koło w zasięgu raycasta (do podglądu / telemetrii). */
	inRange: boolean;
	/** Sprężyna faktycznie ściśnięta — prawdziwy kontakt z podłożem. */
	compressing: boolean;
	distance: number;
	normal: THREE.Vector3;
	point: THREE.Vector3;
};

/** Max prędkość zbliżania do podłoża (m/s) — powyżej = jeszcze w locie (nie „na ziemi”). */
const GROUND_APPROACH_MAX_MPS = 1.75;

const CORNER_LOCAL = [
	new THREE.Vector3(RL_CAR.hitboxHalfX * 0.92, 0, RL_CAR.hitboxHalfZ * 0.92),
	new THREE.Vector3(-RL_CAR.hitboxHalfX * 0.92, 0, RL_CAR.hitboxHalfZ * 0.92),
	new THREE.Vector3(RL_CAR.hitboxHalfX * 0.92, 0, -RL_CAR.hitboxHalfZ * 0.92),
	new THREE.Vector3(-RL_CAR.hitboxHalfX * 0.92, 0, -RL_CAR.hitboxHalfZ * 0.92),
];

/**
 * Rocket League–style raycast hovercar: jeden box + 4 sprężyny raycast.
 * Zastępuje stary Player (Wheel/Collider drive).
 */
class RocketCar extends GameObject {
	boostFuel: number = RL_CAR.boostSpawn;
	/** Rush / Overcharge — mnożniki ustawiane z GameSession. */
	boostRegenMul = 1;
	boostForceMul = 1;
	/** Ignition Zone Low Grav — 1 = normalna grawitacja. */
	gravityScale = 1;
	/** Experimental bodyStyle hooks (v0.8) — wyłączone w Core. */
	bodyTraitsEnabled = false;
	bodyTraits: CarBodyTraits = getTraitsForBodyStyle("standard");

	readonly visualRoot: THREE.Object3D;
	readonly recoveryPos = new THREE.Vector3();

	private isGrounded = false;
	private wheelsGrounded = 0;
	private wheelsCompressing = 0;
	private canSecondJump = true;
	private jumpCount = 0;
	private jumpHoldLeft = 0;
	/** Odliczanie okna dodge — startuje po zakończeniu jump hold (RL: 1.25–1.45 s). */
	private dodgeWindowAge = 0;
	private flipActive = false;
	private flipTimer = 0;
	private flipElapsed = 0;
	private flipGravityOffLeft = 0;
	private flipRelTorquePitch = 0;
	private flipRelTorqueRoll = 0;
	private flipPitchRateMul = 1;
	private flipPitchLockLeft = 0;
	private neutralJumpLockLeft = 0;
	private jumpStickyLeft = 0;
	private wasGroundedLastFrame = false;
	private groundedReleaseLeft = 0;
	private landingPulse = 0;
	private jumpCooldown = 0;
	private disableSuspensionTimer = 0;
	private recoveryCooldown = 0;
	private wallContactLeft = 0;
	private wallProbeActive = false;
	private wasOnWallLastFrame = false;
	/** Po skoku ze ściany — bez stick/sep-damp, żeby jump działał. */
	private wallJumpDetachLeft = 0;
	private flipImpulseTicksLeft = 0;
	private flipImpulseFwdPerTick = 0;
	private flipImpulseSidePerTick = 0;

	private boosting = false;
	private readonly surfaceNormal = new THREE.Vector3(0, 1, 0);

	private lastThrottle = 0;
	private lastYaw = 0;
	private lastRoll = 0;
	private lastBoosting = false;
	private lastDrifting = false;
	/** 0 = pełny grip, 1 = pełny powerslide — soft exit po puszczeniu Shift. */
	private driftBlend = 0;
	private ballSteerMul = 1;

	private readonly _wheelHits: WheelHit[] = CORNER_LOCAL.map(() => ({
		hit: false,
		inRange: false,
		compressing: false,
		distance: RL_HOVER.suspensionMaxLength,
		normal: new THREE.Vector3(0, 1, 0),
		point: new THREE.Vector3(),
	}));
	private readonly _cornerWorld = new THREE.Vector3();
	private readonly _rayDir = new THREE.Vector3();
	private readonly _flipImpulseFwdDir = new THREE.Vector3();
	private readonly _flipImpulseSideDir = new THREE.Vector3();
	private readonly _force = new THREE.Vector3();
	private readonly _vel = new THREE.Vector3();
	private readonly _velAt = new THREE.Vector3();
	private readonly _fwd = new THREE.Vector3();
	private readonly _right = new THREE.Vector3();
	private readonly _up = new THREE.Vector3();
	private readonly _tmp = new THREE.Vector3();
	private readonly _quat = new THREE.Quaternion();
	private readonly _tmpQ = new THREE.Quaternion();
	private readonly _alignMat = new THREE.Matrix4();
	private readonly _carUp = new THREE.Vector3();

	private suspensionViz: SuspensionVisualizer | null = null;
	private physicsStepCounter = 0;
	private lastSuspensionForceMag = 0;
	private groundDriveLinvel: { x: number; y: number; z: number } | null = null;
	private frameDriveDtAcc = 0;

	constructor(scene: Scene, mesh: THREE.Mesh) {
		const correctedMesh = new THREE.Object3D();
		correctedMesh.add(mesh);

		const colliderData: RigidBodyData = {
			colliderDesc: RAPIER.ColliderDesc.cuboid(
				RL_CAR.hitboxHalfX,
				RL_CAR.hitboxHalfY,
				RL_CAR.hitboxHalfZ,
			)
				.setMass(RL_CAR.mass)
				.setFriction(0.05)
				.setRestitution(0)
				.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
				.setContactForceEventThreshold(8),
			rigidBodyDesc: RAPIER.RigidBodyDesc.dynamic()
				.setLinearDamping(RL_CAR.linearDamp)
				.setAngularDamping(RL_CAR.angularDamp)
				.setCcdEnabled(true),
		};

		super(scene, correctedMesh as THREE.Mesh, colliderData);
		this.visualRoot = mesh;
		if (HOVER_DEBUG_RAYS) {
			this.suspensionViz = new SuspensionVisualizer(scene.threeJSScene);
		}
		this.threeJSGroup.frustumCulled = false;
		this.threeJSGroup.traverse((obj) => {
			obj.frustumCulled = false;
			obj.visible = true;
			if (obj instanceof THREE.Mesh) {
				obj.castShadow = true;
				obj.receiveShadow = true;
				obj.geometry?.computeBoundingSphere();
			}
		});
	}

	/** Włącz / wyłącz body traits z `modePolicy.features.bodyTraits`. */
	setBodyTraits(traits: CarBodyTraits, enabled: boolean): void {
		this.bodyTraits = traits;
		this.bodyTraitsEnabled = enabled;
	}

	control(input: ControlInput, dt: number): void {
		this.lastThrottle = input.forward();
		this.lastYaw = input.yaw();
		this.lastRoll = HOVER_SAFE_MODE ? 0 : input.roll();
		this.lastBoosting = HOVER_SAFE_MODE
			? false
			: input.isBoosting() && this.boostFuel > 0;
		this.lastDrifting = HOVER_SAFE_MODE ? false : input.isShiftDown();
		this.boosting = this.lastBoosting;

		/** Wejście w slide: natychmiast. Wyjście: soft blend (anty-tank snap). */
		if (this.lastDrifting) {
			this.driftBlend = 1;
		} else if (this.driftBlend > 0) {
			const exitSec = Math.max(1e-3, RL_CAR.gripExitBlendSec);
			this.driftBlend = THREE.MathUtils.damp(
				this.driftBlend,
				0,
				1 / exitSec,
				dt,
			);
			if (this.driftBlend < 0.02) this.driftBlend = 0;
		}

		this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
		this.wallJumpDetachLeft = Math.max(0, this.wallJumpDetachLeft - dt);
		this.flipPitchLockLeft = Math.max(0, this.flipPitchLockLeft - dt);
		this.neutralJumpLockLeft = Math.max(0, this.neutralJumpLockLeft - dt);

		this.recoveryCooldown = Math.max(0, this.recoveryCooldown - dt);

		let jumpsLeft = 3;
		while (jumpsLeft-- > 0 && input.consumeJump()) {
			this.processJumpPress(input);
		}

		if (!HOVER_SAFE_MODE) {
			if (!this.isGrounded) {
				if (this.jumpCount === 1 && this.jumpHoldLeft <= 0) {
					this.dodgeWindowAge += dt;
				}
			}
			if (!this.isGrounded && this.jumpCount === 1) {
				if (input.isJumpHeld()) {
					this.applyJumpHold(true, dt);
				} else if (this.jumpHoldLeft > 0) {
					this.jumpHoldLeft = Math.max(0, this.jumpHoldLeft - dt);
				}
			}
			/** Core: brak passive regen. Rush/OC/Lab ustawiają boostRegenMul > 1. */
			if (!this.lastBoosting && this.boostRegenMul > 1) {
				const airRatio =
					RL_CAR.boostRegenGround > 0
						? RL_CAR.boostRegenAir / RL_CAR.boostRegenGround
						: 0;
				const rate = this.isGrounded ? 1 : airRatio;
				this.boostFuel = Math.min(
					1,
					this.boostFuel +
						dt * RL_CAR.boostRegenGround * rate * this.boostRegenMul,
				);
			}
		}

		this.recoverFromCrash();
	}

	/** Wejście bota / AI — ten sam pipeline co gracz (ControlInput). */
	updateInputs(input: SimulatedInput, dt: number): void {
		this.control(new SimulatedControlInput(input), dt);
	}

	/** Wywoływane przed każdym krokiem Rapier (120 Hz sub-step). */
	integrateHover(dt: number, substep = 0, substepCount = 1): void {
		const isLastSubstep = substep >= substepCount - 1;
		this.disableSuspensionTimer = Math.max(0, this.disableSuspensionTimer - dt);

		this.castSuspension();
		this.updateGroundedState(dt);
		this.updateWallContactState(dt);

		const meridian = isMeridianArenaActive();
		const onWall = this.isOnWallOrRamp();
		/** Turtle / nos w górę na murawie — NIE na ścianie/suficie (tam forward.y≈1 = jazda w górę). */
		const isVerticalStand =
			!onWall && Math.abs(this.getForward().y) > 0.85;
		/**
		 * Meridian: nie używaj isVerticalStand — przy wkopanym nosie forward.y≈1
		 * i gate wyłączał align dokładnie wtedy, gdy jest potrzebny.
		 */
		const meridianContact =
			meridian &&
			this.wheelsGrounded >= 1 &&
			this.disableSuspensionTimer <= 0;
		const meridianDrive =
			meridianContact && this.isGrounded && this.wheelsCompressing >= 1;
		const stableDrive =
			!meridian &&
			this.isGrounded &&
			Math.abs(this.getUpward().y) >= 0.7 &&
			!isVerticalStand &&
			!onWall;

		if (meridianContact) {
			// Każdy substep — podwozie zawsze równolegle do stycznej sfery.
			this.alignMeridianAttitude(dt, true);
		}

		if (meridianDrive || stableDrive) {
			this.syncGroundJumpState();
			this.applySuspensionForces();
			if (!HOVER_SAFE_MODE) {
				if (meridian) {
					this.applyMeridianSurfaceForces();
				} else {
					this.applyWallRideForces();
				}
			}
			this.frameDriveDtAcc += dt;
			if (isLastSubstep) {
				this.applyGroundDrive(this.frameDriveDtAcc, meridian);
				this.frameDriveDtAcc = 0;
				if (!meridian) {
					this.lockGroundPitchRoll();
				}
			}
		} else {
			const canSuspension =
				this.wheelsGrounded > 0 &&
				this.disableSuspensionTimer <= 0 &&
				(this.isGrounded || onWall || meridianContact);
			/**
			 * Wall drive: NIE wymagaj isGrounded — przy wjeździe w rampę approach
			 * często > progu i grounded miga → bez align/drive auto zostaje płaskie i odpada.
			 */
			const wallDrive =
				!meridian &&
				onWall &&
				this.disableSuspensionTimer <= 0 &&
				this.wheelsGrounded >= 1 &&
				this.wheelsCompressing >= 1;

			if (onWall && !meridian && this.wheelsGrounded >= 1) {
				/** Bez gazu/boost — nie twarde align (RL: coast → peel). */
				if (Math.abs(this.lastThrottle) > 0.12 || this.lastBoosting) {
					this.alignWallAttitude(dt);
				}
			}

			if (wallDrive) {
				this.syncGroundJumpState();
				if (canSuspension) {
					this.applySuspensionForces();
				}
				if (!HOVER_SAFE_MODE) {
					this.applyWallRideForces();
				}
				this.frameDriveDtAcc += dt;
				if (isLastSubstep) {
					this.applyGroundDrive(this.frameDriveDtAcc, false);
					this.frameDriveDtAcc = 0;
				}
				this.rapierRigidBody.setLinearDamping(RL_CAR.linearDamp);
			} else {
				this.frameDriveDtAcc = 0;
				if (canSuspension) {
					this.applySuspensionForces();
				}
				if (!HOVER_SAFE_MODE) {
					if (
						meridian &&
						this.wheelsGrounded > 0 &&
						this.disableSuspensionTimer <= 0
					) {
						this.applyMeridianSurfaceForces();
					} else if (!meridian) {
						this.applyWallRideForces();
					}
					if (!meridianContact) {
						this.applyFlipPhysics(dt);
						this.applyAirThrottle(dt);
					}
				}
				if (!meridianContact) {
					this.applyRlAirControl(dt);
				}
				let airDamp = RL_CAR.airLinearDamp;
				if (this.lastBoosting && this.boostFuel > 0 && !this.isGrounded) {
					airDamp *= RL_CAR.airBoostLinearDampMul;
				}
				this.rapierRigidBody.setLinearDamping(
					meridianContact ? RL_CAR.linearDamp : airDamp,
				);
			}
		}

		this.recoverFromCrash();
		this.logHoverTelemetry();
	}

	/** Wywoływane po world.step() — kinematyczna jazda po tarcie Rapiera. */
	finalizeHoverStep(substep = 0, substepCount = 1): void {
		if (substep < substepCount - 1) return;
		const meridian = isMeridianArenaActive();
		const onWall = this.isOnWallOrRamp();
		const isVerticalStand =
			!onWall && Math.abs(this.getForward().y) > 0.85;
		const stableDrive =
			!meridian &&
			this.isGrounded &&
			Math.abs(this.getUpward().y) >= 0.7 &&
			!isVerticalStand &&
			!onWall;
		const wallDrive =
			!meridian &&
			onWall &&
			this.wheelsGrounded >= 1 &&
			this.wheelsCompressing >= 1;
		const meridianDrive =
			meridian &&
			this.isGrounded &&
			this.wheelsCompressing >= 1 &&
			this.wheelsGrounded >= 1;
		if (meridian && this.wheelsGrounded >= 1 && this.disableSuspensionTimer <= 0) {
			this.alignMeridianAttitude(1 / 60, true);
		}
		if ((stableDrive || wallDrive || meridianDrive) && this.groundDriveLinvel) {
			const current = this.rapierRigidBody.linvel();
			this._up.copy(this.surfaceNormal).normalize();
			const currentUp =
				current.x * this._up.x +
				current.y * this._up.y +
				current.z * this._up.z;
			const targetUp =
				this.groundDriveLinvel.x * this._up.x +
				this.groundDriveLinvel.y * this._up.y +
				this.groundDriveLinvel.z * this._up.z;
			this._vel.set(
				this.groundDriveLinvel.x - this._up.x * targetUp,
				this.groundDriveLinvel.y - this._up.y * targetUp,
				this.groundDriveLinvel.z - this._up.z * targetUp,
			);
			this._vel.x += this._up.x * currentUp;
			this._vel.y += this._up.y * currentUp;
			this._vel.z += this._up.z * currentUp;
			this.rapierRigidBody.setLinvel(
				{ x: this._vel.x, y: this._vel.y, z: this._vel.z },
				true,
			);
		}
		this.groundDriveLinvel = null;
	}

	afterPhysics(_dt: number): void {
		this.syncWithRigidBody();
		this.updateSuspensionDebugDraw();
	}

	disposeHoverDebug(): void {
		this.suspensionViz?.dispose();
		this.suspensionViz = null;
	}

	isBoosting(): boolean {
		return this.boosting;
	}

	isFlipping(): boolean {
		return this.flipActive;
	}

	getBoostFuel(): number {
		return this.boostFuel;
	}

	/** Boost pad / pickup — dodaje do zbiornika (0–1). */
	addBoostFuel(amount: number): void {
		if (amount <= 0) return;
		this.boostFuel = Math.min(1, this.boostFuel + amount);
	}

	/** Ostatni input skrętu [-1, 1] — wizualizacja kół. */
	getSteerInput(): number {
		return this.lastYaw;
	}

	getSurfaceNormal(): THREE.Vector3 {
		return this.surfaceNormal;
	}

	isOnGround(): boolean {
		return this.isGrounded;
	}

	/** Siła lądowania 0–1 — jednorazowo po dotknięciu ziemi (VFX). */
	consumeLandingPulse(): number {
		const pulse = this.landingPulse;
		this.landingPulse = 0;
		return pulse;
	}

	/** Liczba kół na powierzchni (0–4) — m.in. dla kamery (air flip lock). */
	getWheelsGroundedCount(): number {
		return this.wheelsGrounded;
	}

	isOnWallOrRamp(): boolean {
		if (this.wallContactLeft > 0) {
			return true;
		}
		return (
			this.isGrounded && this.surfaceNormal.y < RL_CAR.wallNormalFlatThreshold
		);
	}

	updateBallSteerContext(ballPos: THREE.Vector3): void {
		const dist = this.getPosition().distanceTo(ballPos);
		const t = THREE.MathUtils.clamp(
			1 - dist / RL_CAR.steerNearBallRadius,
			0,
			1,
		);
		this.ballSteerMul = THREE.MathUtils.lerp(1, RL_CAR.steerNearBallMul, t * t);
	}

	setRecoveryAnchor(pos: THREE.Vector3): void {
		this.recoveryPos.copy(pos);
	}

	/** Twardy reset na marker kickoff — płasko na kołach, zero prędkości. */
	resetKickoffPose(x: number, y: number, z: number, yawY: number): void {
		this.rapierRigidBody.setTranslation({ x, y, z }, true);
		this.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		this.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		this._quat.setFromEuler(new THREE.Euler(0, yawY, 0, "YXZ"));
		this.rapierRigidBody.setRotation(
			{ x: this._quat.x, y: this._quat.y, z: this._quat.z, w: this._quat.w },
			true,
		);
		this.rapierRigidBody.wakeUp();
		this.resetJumpState();
		this.isGrounded = false;
		this.wheelsGrounded = 0;
		this.wheelsCompressing = 0;
		this.syncWithRigidBody();
		this.recoveryPos.set(x, y, z);
	}

	private castSuspension(): void {
		const pos = this.rapierRigidBody.translation();
		const rot = this.rapierRigidBody.rotation();
		this._quat.set(rot.x, rot.y, rot.z, rot.w);
		this._up.set(0, 1, 0).applyQuaternion(this._quat).normalize();

		let hitCount = 0;
		let compressCount = 0;
		const normalAcc = this._tmp.set(0, 0, 0);

		for (let i = 0; i < CORNER_LOCAL.length; i++) {
			const wh = this._wheelHits[i]!;
			const dbg = _rayDebugScratch[i]!;
			const local = CORNER_LOCAL[i]!;
			this._cornerWorld.copy(local).applyQuaternion(this._quat);
			this._cornerWorld.x += pos.x;
			this._cornerWorld.y += pos.y + RL_CAR.hitboxHalfY * 0.15;
			this._cornerWorld.z += pos.z;

			dbg.origin.copy(this._cornerWorld);
			this._rayDir.copy(this._up).multiplyScalar(-1);
			dbg.end
				.copy(this._cornerWorld)
				.addScaledVector(this._rayDir, RL_HOVER.suspensionMaxLength);

			const ray = new RAPIER.Ray(
				{
					x: this._cornerWorld.x,
					y: this._cornerWorld.y,
					z: this._cornerWorld.z,
				},
				{ x: this._rayDir.x, y: this._rayDir.y, z: this._rayDir.z },
			);

			const maxToi = RL_HOVER.suspensionMaxLength;
			const hit = this.scene.rapierWorld.castRayAndGetNormal(
				ray,
				maxToi,
				true,
				undefined,
				undefined,
				undefined,
				this.rapierRigidBody,
			);

			if (hit && hit.timeOfImpact <= RL_HOVER.suspensionRestLength + 0.1) {
				wh.hit = true;
				wh.inRange = true;
				wh.compressing = hit.timeOfImpact < RL_HOVER.suspensionRestLength;
				wh.distance = hit.timeOfImpact;
				wh.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
				// Normalna przeciw rayDir (= w stronę auta) — także na suficie (n.y < 0).
				if (wh.normal.dot(this._rayDir) > 0) wh.normal.negate();
				wh.point
					.copy(this._rayDir)
					.multiplyScalar(-hit.timeOfImpact)
					.add(this._cornerWorld);
				dbg.hit = true;
				dbg.end
					.copy(this._cornerWorld)
					.addScaledVector(this._rayDir, hit.timeOfImpact);
				normalAcc.add(wh.normal);
				hitCount++;
				if (wh.compressing) compressCount++;
			} else {
				wh.hit = false;
				wh.inRange = false;
				wh.compressing = false;
				wh.distance = hit?.timeOfImpact ?? maxToi;
				dbg.hit = false;
				if (hit) {
					dbg.end
						.copy(this._cornerWorld)
						.addScaledVector(this._rayDir, hit.timeOfImpact);
				}
			}
		}

		this.wheelsGrounded = hitCount;
		this.wheelsCompressing = compressCount;

		if (hitCount > 0) {
			if (isMeridianArenaActive()) {
				// Stabilny normal sfery (nie noisy trimesh / negate-by-y).
				meridianSurfaceNormalAt(pos, this.surfaceNormal);
				for (const wh of this._wheelHits) {
					if (wh.inRange) wh.normal.copy(this.surfaceNormal);
				}
			} else {
				this.surfaceNormal
					.copy(normalAcc.multiplyScalar(1 / hitCount))
					.normalize();
			}
		} else if (this.wallContactLeft <= 0) {
			/** Grace ściany: zostaw ostatni normal — (0,1,0) + stick = wywrotka. */
			this.surfaceNormal.set(0, 1, 0);
		}

		if (!isMeridianArenaActive()) {
			this.castWallProbe(pos, hitCount);
		} else {
			this.wallProbeActive = false;
		}
	}

	/** Promień z przodu auta — wykrywa bandę gdy zawieszenie jeszcze widzi podłogę. */
	private castWallProbe(
		pos: { x: number; y: number; z: number },
		wheelHits: number,
	): void {
		this.wallProbeActive = false;
		carHorizontalForwardFromQuat(this._quat, this._fwd);
		const horizLen = Math.hypot(this._fwd.x, this._fwd.z);
		if (horizLen < 0.15) return;

		this._rayDir.set(this._fwd.x / horizLen, 0, this._fwd.z / horizLen);
		this._cornerWorld.set(
			pos.x + this._rayDir.x * RL_CAR.hitboxHalfX,
			pos.y + RL_CAR.hitboxHalfY * 0.35,
			pos.z + this._rayDir.z * RL_CAR.hitboxHalfX,
		);

		let onRampApproach = false;
		for (const wh of this._wheelHits) {
			if (!wh.inRange) continue;
			if (wh.normal.y < RL_CAR.wallNormalFlatThreshold && wh.normal.y > 0.2) {
				onRampApproach = true;
				break;
			}
		}

		const maxToi = RL_CAR.hitboxHalfX + (onRampApproach ? 0.85 : 0.45);
		const ray = new RAPIER.Ray(
			{
				x: this._cornerWorld.x,
				y: this._cornerWorld.y,
				z: this._cornerWorld.z,
			},
			{ x: this._rayDir.x, y: this._rayDir.y, z: this._rayDir.z },
		);
		const hit = this.scene.rapierWorld.castRayAndGetNormal(
			ray,
			maxToi,
			true,
			undefined,
			undefined,
			undefined,
			this.rapierRigidBody,
		);
		if (!hit) return;

		this._vel.set(hit.normal.x, hit.normal.y, hit.normal.z);
		if (this._vel.dot(this._rayDir) > 0) this._vel.negate();
		if (this._vel.y >= RL_CAR.wallNormalFlatThreshold) return;

		this.wallProbeActive = true;
		this._vel.normalize();
		if (wheelHits > 0) {
			/** Koła na łuku — blend, nie hard-swap (nagły n wywraca auto). */
			const blend = THREE.MathUtils.clamp(
				(this.surfaceNormal.y - 0.35) / 0.55,
				0,
				0.55,
			);
			this.surfaceNormal.lerp(this._vel, blend).normalize();
		} else {
			this.surfaceNormal.copy(this._vel);
		}
	}

	/**
	 * „Na ziemi” tylko przy ściśniętej zawieszeniu i wolnym lądowaniu —
	 * raycast w zasięgu podczas szybkiego opadu nie wyłącza boosta w powietrzu.
	 */
	private updateGroundedState(dt: number): void {
		if (this.disableSuspensionTimer > 0 || this.flipActive) {
			this.isGrounded = false;
			this.groundedReleaseLeft = 0;
			return;
		}

		const vel = this.rapierRigidBody.linvel();
		const n = this.surfaceNormal;
		const approach = -(vel.x * n.x + vel.y * n.y + vel.z * n.z);

		const rawGrounded =
			this.wheelsCompressing >= RL_HOVER.groundedMinWheels &&
			approach < GROUND_APPROACH_MAX_MPS;

		if (rawGrounded) {
			this.groundedReleaseLeft = RL_HOVER.groundReleaseGrace;
			this.isGrounded = true;
		} else if (
			this.groundedReleaseLeft > 0 &&
			this.wheelsCompressing >= 1 &&
			approach < GROUND_APPROACH_MAX_MPS + 1.2
		) {
			this.groundedReleaseLeft = Math.max(0, this.groundedReleaseLeft - dt);
			this.isGrounded = true;
		} else {
			this.isGrounded = false;
			this.groundedReleaseLeft = 0;
		}

		if (this.isGrounded && !this.wasGroundedLastFrame) {
			this.applySoftLanding();
		}
		this.wasGroundedLastFrame = this.isGrounded;
	}

	private countWallWheels(): number {
		let count = 0;
		for (const wh of this._wheelHits) {
			if (!wh.inRange) continue;
			if (wh.normal.y < RL_CAR.wallNormalFlatThreshold) count++;
		}
		return count;
	}

	private updateWallContactState(dt: number): void {
		const wallWheels = this.countWallWheels();
		if (
			(wallWheels >= 1 &&
				(this.wheelsCompressing >= 1 || this.wallContactLeft > 0)) ||
			this.wallProbeActive
		) {
			this.wallContactLeft = RL_HOVER.wallContactGrace;
		} else {
			this.wallContactLeft = Math.max(0, this.wallContactLeft - dt);
		}
		const onWall = this.isOnWallOrRamp();
		if (
			this.bodyTraitsEnabled &&
			this.bodyTraits.hook === "aeroSnap" &&
			this.wasOnWallLastFrame &&
			!onWall
		) {
			this.applyAeroSnapExit();
		}
		this.wasOnWallLastFrame = onWall;
	}

	/** low / AeroSnap — +curve po zejściu ze ściany (bez zmiany masy). */
	private applyAeroSnapExit(): void {
		const mul = this.bodyTraits.aeroSnapCurveMul;
		if (mul <= 1) return;
		const vel = this.getVelocity();
		this._right.copy(this.getSideward()).normalize();
		const side = vel.dot(this._right);
		if (Math.abs(side) < 0.45) return;
		const boost = Math.abs(side) * (mul - 1);
		vel.addScaledVector(this._right, Math.sign(side) * boost);
		clampSpeedMps(vel, RL_CAR.maxSpeed);
		this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
		const av = this.rapierRigidBody.angvel();
		const yawBoost = Math.sign(side) * 0.55 * (mul - 1);
		this.rapierRigidBody.setAngvel(
			{ x: av.x, y: av.y + yawBoost, z: av.z },
			true,
		);
	}

	private applySoftLanding(): void {
		const vel = this.getVelocity();
		const n = this.surfaceNormal;
		/** Wjazd w rampę/ścianę — nie zjadaj stycznej (to nie lądowanie z powietrza). */
		const rampOrWall =
			this.wallContactLeft > 0 ||
			n.y < RL_CAR.wallNormalFlatThreshold;
		const vn = vel.dot(n);
		const impact = Math.max(0, -vn);
		if (impact > 0.8 && !rampOrWall) {
			this.landingPulse = THREE.MathUtils.clamp(impact / 9, 0.2, 1);
		}
		if (vn < -0.35) {
			const retain = rampOrWall
				? Math.max(RL_CAR.landingNormalRetain, 0.88)
				: RL_CAR.landingNormalRetain;
			vel.addScaledVector(n, -vn * (1 - retain));
			this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
		}

		const av = this.rapierRigidBody.angvel();
		const spinRetain = rampOrWall
			? Math.max(RL_CAR.landingSpinRetain, 0.85)
			: RL_CAR.landingSpinRetain;
		this._vel.set(av.x, av.y, av.z).multiplyScalar(spinRetain);
		this.rapierRigidBody.setAngvel(
			{ x: this._vel.x, y: this._vel.y, z: this._vel.z },
			true,
		);
	}

	private performLiftOffJump(): void {
		const onWall = this.isOnWallOrRamp();
		this._up.copy(this.getUpward()).normalize();
		const vel = this.getVelocity();
		const vn = vel.dot(this._up);
		if (vn < 0) vel.addScaledVector(this._up, -vn);
		vel.addScaledVector(this._up, RL_CAR.jumpImpulse);
		clampSpeedMps(vel, RL_CAR.maxSpeed);
		this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);

		this.disableSuspensionTimer = 0.2;
		this.jumpCooldown = RL_CAR.jumpGroundCooldown;
		this.isGrounded = false;
		this.jumpCount = 1;
		this.dodgeWindowAge = 0;
		this.jumpHoldLeft = RL_CAR.jumpHoldMax;
		this.jumpStickyLeft = RL_CAR.stickyDuration;
		this.wheelsGrounded = 0;
		this.wheelsCompressing = 0;
		if (onWall) {
			/** Odklejenie — inaczej stick w tej samej klatce zjada impuls. */
			this.wallContactLeft = 0;
			this.wallProbeActive = false;
			this.wallJumpDetachLeft = RL_CAR.wallJumpDetachSec;
		}
	}

	private applySuspensionForces(): void {
		if (this.disableSuspensionTimer > 0) return;
		const body = this.rapierRigidBody;
		const linvel = body.linvel();
		const angvel = body.angvel();
		const pos = body.translation();
		const rot = body.rotation();
		this._quat.set(rot.x, rot.y, rot.z, rot.w);
		this._carUp.set(0, 1, 0).applyQuaternion(this._quat).normalize();

		let forceSum = 0;

		for (let i = 0; i < this._wheelHits.length; i++) {
			const wh = this._wheelHits[i]!;
			if (!wh.compressing) continue;

			const compression = RL_HOVER.suspensionRestLength - wh.distance;
			if (compression <= 0) continue;

			this._velAt.set(
				linvel.x +
					angvel.y * (wh.point.z - pos.z) -
					angvel.z * (wh.point.y - pos.y),
				linvel.y +
					angvel.z * (wh.point.x - pos.x) -
					angvel.x * (wh.point.z - pos.z),
				linvel.z +
					angvel.x * (wh.point.y - pos.y) -
					angvel.y * (wh.point.x - pos.x),
			);
			const vAlong = this._velAt.dot(this._carUp);
			const forceMag =
				RL_HOVER.suspensionStiffness * compression -
				RL_HOVER.suspensionDamping * vAlong;
			if (forceMag <= 0) continue;

			this._force.copy(this._carUp).multiplyScalar(forceMag);
			if (!this.auditSuspensionForce(i, forceMag, wh.distance, this._force)) {
				continue;
			}

			forceSum += forceMag;
			body.addForceAtPoint(
				{ x: this._force.x, y: this._force.y, z: this._force.z },
				{ x: wh.point.x, y: wh.point.y, z: wh.point.z },
				true,
			);
		}

		this.lastSuspensionForceMag = forceSum;

		this.rapierRigidBody.setLinearDamping(RL_CAR.linearDamp);
		this.rapierRigidBody.setAngularDamping(RL_CAR.angularDamp);
	}

	private applyWallRideForces(): void {
		if (HOVER_SAFE_MODE || !this.isOnWallOrRamp()) return;
		/** Skok ze ściany — nie klej z powrotem. */
		if (this.wallJumpDetachLeft > 0 || this.disableSuspensionTimer > 0) {
			return;
		}

		const body = this.rapierRigidBody;
		const mass = RL_CAR.mass;
		const n = this.surfaceNormal;
		const speed = this.getVelocity().length();

		/**
		 * RL: stick wymaga gazu/boostu (albo residualnej prędkości).
		 * Bez pedału — stick gaśnie, grawitacja ściąga (zwłaszcza sufit).
		 */
		const driveIntent = Math.max(
			Math.abs(this.lastThrottle),
			this.lastBoosting ? 0.9 : 0,
		);
		const coasting = driveIntent < 0.12;
		const driveMul = coasting
			? THREE.MathUtils.clamp((speed - 7) / 14, 0, 0.4)
			: THREE.MathUtils.lerp(0.65, 1.12, THREE.MathUtils.clamp(driveIntent, 0, 1));

		// Rapier stosuje grawitację świata. Kompensacja tylko gdy aktywnie kleimy —
		// przy coast na suficie/ścianie grawitacja ma prawo oderwać auto.
		if (
			!coasting &&
			driveMul > 0.35 &&
			n.y < RL_CAR.wallNormalFlatThreshold
		) {
			const gDotN = WORLD_GRAVITY * n.y;
			this._force.copy(n).multiplyScalar(-gDotN * mass);
			body.addForce(
				{ x: this._force.x, y: this._force.y, z: this._force.z },
				true,
			);
		}

		if (driveMul < 0.05) {
			return;
		}

		/** Płytka rampa (wjazd) — bez mocnego sticku (inaczej podbicie). */
		const flatFade =
			n.y > 0.72
				? THREE.MathUtils.clamp(1 - (n.y - 0.72) / 0.22, 0, 1)
				: 1;
		if (flatFade < 0.05) return;

		const speedMul = THREE.MathUtils.clamp(
			0.75 + speed / RL_CAR.wallSpeedStickRef,
			0.8,
			1.35,
		);
		const ceilingMul =
			n.y < -0.35 ? RL_CAR.wallCeilingStickMul : n.y < 0.2 ? 1.12 : 1;
		/** Quarter-pipe: lekki boost stick na łuku — bez klejenia. */
		const curveMul = n.y > 0.2 && n.y < 0.8 ? 1.18 : 1;
		/** Przy niskiej prędkości słabszy stick — łatwiejszy zjazd / odklejenie. */
		const slowMul = speed < 6 ? 0.55 : speed < 12 ? 0.82 : 1;
		const stick =
			RL_HOVER.wallStickAccel *
			mass *
			RL_HOVER.wallRideStickMul *
			speedMul *
			ceilingMul *
			curveMul *
			slowMul *
			driveMul *
			flatFade;
		this._force.copy(n).multiplyScalar(-stick);
		body.addForce(
			{ x: this._force.x, y: this._force.y, z: this._force.z },
			true,
		);

		if (!coasting && n.y < 0.45) {
			const dfMul = n.y < -0.35 ? 1.25 : 0.85;
			this._force
				.copy(n)
				.multiplyScalar(
					-RL_CAR.wallDownforce * mass * dfMul * driveMul * flatFade,
				);
			body.addForce(
				{ x: this._force.x, y: this._force.y, z: this._force.z },
				true,
			);
		}

		/** Sep-damping tylko przy aktywnym wall-ride — coast może odlecieć. */
		if (coasting) return;

		const vel = this.getVelocity();
		let vn = vel.dot(n);
		if (vn > 0.55) {
			const damp = vn > 2.2 ? 0.72 : 0.45;
			vel.addScaledVector(n, -vn * damp);
			body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
			vn = vel.dot(n);
		}
		const sepMax =
			n.y < -0.35
				? RL_CAR.wallRideSeparationMax * 0.75
				: RL_CAR.wallRideSeparationMax;
		if (vn > sepMax) {
			vel.addScaledVector(n, -(vn - sepMax));
			body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
		}
	}

	/**
	 * Meridian: grawitacja świata → składowa styczna do sfery + stick do powierzchni.
	 * Bez tego auto odpada / flipuje na krzywiznie.
	 */
	private applyMeridianSurfaceForces(): void {
		if (HOVER_SAFE_MODE || this.wheelsGrounded < 1) return;
		const body = this.rapierRigidBody;
		const mass = RL_CAR.mass;
		const n = this.surfaceNormal;

		// Anuluj składową grawitacji wzdłuż normalnej (efekt: „dół” = w sferę).
		const gDotN = WORLD_GRAVITY * n.y;
		this._force.copy(n).multiplyScalar(-gDotN * mass);
		body.addForce(
			{ x: this._force.x, y: this._force.y, z: this._force.z },
			true,
		);

		const stick =
			RL_HOVER.wallStickAccel * mass * RL_HOVER.wallRideStickMul * 1.35;
		this._force.copy(n).multiplyScalar(-stick);
		body.addForce(
			{ x: this._force.x, y: this._force.y, z: this._force.z },
			true,
		);

		this._force.copy(n).multiplyScalar(-RL_CAR.wallDownforce * mass * 0.85);
		body.addForce(
			{ x: this._force.x, y: this._force.y, z: this._force.z },
			true,
		);

		const vel = this.getVelocity();
		let vn = vel.dot(n);
		if (vn > 0.15) {
			vel.addScaledVector(n, -vn * 0.9);
			body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
			vn = vel.dot(n);
		}
		if (vn > 0.8) {
			vel.addScaledVector(n, -(vn - 0.8));
			body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
		}
	}

	/**
	 * Podwozie równolegle do ściany/sufitu — miękki slerp (nie hard-snap jak Meridian).
	 */
	private alignWallAttitude(dt: number): void {
		if (this.wheelsGrounded < 1 || this.flipActive) return;
		if (this.wallJumpDetachLeft > 0) return;
		if (this.surfaceNormal.y >= RL_CAR.wallNormalFlatThreshold) return;

		const n = this.surfaceNormal;
		this._carUp.copy(this.getUpward());
		const align = this._carUp.dot(n);
		if (align > 0.985) return;

		this._fwd.copy(this.getForward());
		this.projectOnPlane(this._fwd, n);
		if (this._fwd.lengthSq() < 1e-8) {
			this._fwd.copy(this.getSideward());
			this.projectOnPlane(this._fwd, n);
		}
		if (this._fwd.lengthSq() < 1e-8) return;
		this._fwd.normalize();
		this._right.crossVectors(n, this._fwd).normalize();
		this._fwd.crossVectors(this._right, n).normalize();

		this._alignMat.makeBasis(this._right, n, this._fwd);
		this._quat.setFromRotationMatrix(this._alignMat);

		const rot = this.rapierRigidBody.rotation();
		this._tmpQ.set(rot.x, rot.y, rot.z, rot.w);
		const rate = THREE.MathUtils.clamp(
			dt * RL_CAR.wallAlignSlerp * 60,
			0,
			0.45,
		);
		this._tmpQ.slerp(this._quat, rate);
		this.rapierRigidBody.setRotation(
			{ x: this._tmpQ.x, y: this._tmpQ.y, z: this._tmpQ.z, w: this._tmpQ.w },
			true,
		);

		const av = this.rapierRigidBody.angvel();
		this._vel.set(av.x, av.y, av.z);
		const yawRate = this._vel.dot(n);
		const keep = this._vel.addScaledVector(n, -yawRate).multiplyScalar(0.55);
		this.rapierRigidBody.setAngvel(
			{
				x: n.x * yawRate + keep.x,
				y: n.y * yawRate + keep.y,
				z: n.z * yawRate + keep.z,
			},
			true,
		);
	}

	/**
	 * Podwozie równolegle do stycznej sfery (jak lockGroundPitchRoll, ale lokalnie).
	 * getForward() = lokalne +Z — bez negacji w makeBasis.
	 */
	private alignMeridianAttitude(dt: number, hardSnap: boolean): void {
		if (this.wheelsGrounded < 1) return;
		if (this.flipActive) return;

		const n = this.surfaceNormal;
		this._carUp.copy(this.getUpward());
		const align = this._carUp.dot(n);

		// Zachowaj yaw: rzut forward na płaszczyznę styczną.
		this._fwd.copy(this.getForward());
		this.projectOnPlane(this._fwd, n);
		if (this._fwd.lengthSq() < 1e-8) {
			this._fwd.copy(this.getSideward());
			this.projectOnPlane(this._fwd, n);
		}
		if (this._fwd.lengthSq() < 1e-8) return;
		this._fwd.normalize();
		// right = up × forward (układ prawoskrętny, forward = +Z).
		this._right.crossVectors(n, this._fwd).normalize();
		this._fwd.crossVectors(this._right, n).normalize();

		this._alignMat.makeBasis(this._right, n, this._fwd);
		this._quat.setFromRotationMatrix(this._alignMat);

		const rot = this.rapierRigidBody.rotation();
		this._tmpQ.set(rot.x, rot.y, rot.z, rot.w);

		if (hardSnap || align < 0.92) {
			// Twardy snap — nos nie ma szans wbić się w mesha.
			this._tmpQ.copy(this._quat);
		} else {
			const rate = THREE.MathUtils.clamp(dt * 28, 0, 1);
			this._tmpQ.slerp(this._quat, rate);
		}

		this.rapierRigidBody.setRotation(
			{ x: this._tmpQ.x, y: this._tmpQ.y, z: this._tmpQ.z, w: this._tmpQ.w },
			true,
		);

		// Zostaw tylko spin wokół normalnej (sterowanie); zero pitch/roll.
		const av = this.rapierRigidBody.angvel();
		this._vel.set(av.x, av.y, av.z);
		const yawRate = this._vel.dot(n);
		this.rapierRigidBody.setAngvel(
			{ x: n.x * yawRate, y: n.y * yawRate, z: n.z * yawRate },
			true,
		);

		// Zabij prędkość wbijającą w powierzchnię (nos / całe auto).
		const vel = this.getVelocity();
		const intoSurface = -vel.dot(n);
		if (intoSurface > 0.05) {
			vel.addScaledVector(n, intoSurface);
			this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
		}
	}

	private auditSuspensionForce(
		wheelIndex: number,
		forceMag: number,
		rayDist: number,
		forceVec: THREE.Vector3,
	): boolean {
		const badMag =
			!Number.isFinite(forceMag) ||
			forceMag > HOVER_FORCE_MAX ||
			!Number.isFinite(forceVec.x) ||
			!Number.isFinite(forceVec.y) ||
			!Number.isFinite(forceVec.z) ||
			Math.abs(forceVec.x) > HOVER_FORCE_MAX ||
			Math.abs(forceVec.y) > HOVER_FORCE_MAX ||
			Math.abs(forceVec.z) > HOVER_FORCE_MAX;

		if (badMag) {
			console.error(
				`[CRITICAL PHYSICS FAIL] Siła zawieszenia poza limitem: ${forceMag.toFixed(1)} N ` +
					`(wektor ${forceVec.x.toFixed(1)}, ${forceVec.y.toFixed(1)}, ${forceVec.z.toFixed(1)}) | ` +
					`Odległość raycastu: ${rayDist.toFixed(4)} m | koło #${wheelIndex}`,
			);
			return false;
		}
		return true;
	}

	private logHoverTelemetry(): void {
		if (HOVER_TELEMETRY_EVERY_STEPS <= 0) return;
		this.physicsStepCounter++;
		if (this.physicsStepCounter % HOVER_TELEMETRY_EVERY_STEPS !== 0) return;

		const t = this.rapierRigidBody.translation();
		const v = this.rapierRigidBody.linvel();
		console.info(
			`[HOVER] safe=${HOVER_SAFE_MODE} wheels=${this.wheelsGrounded}/4 grounded=${this.isGrounded} ` +
				`suspOff=${this.disableSuspensionTimer.toFixed(2)}s jumpCd=${this.jumpCooldown.toFixed(2)}s ` +
				`F_sum=${this.lastSuspensionForceMag.toFixed(0)}N pos=(${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)}) ` +
				`vel=(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`,
		);
	}

	private updateSuspensionDebugDraw(): void {
		if (!this.suspensionViz) return;
		this.suspensionViz.update(_rayDebugScratch);
	}

	private applyGroundDrive(dt: number, meridian = false): void {
		if (this.wheelsGrounded < RL_HOVER.groundedMinWheels) return;
		const onWallSurface =
			this.isOnWallOrRamp() &&
			this.surfaceNormal.y < RL_CAR.wallNormalFlatThreshold;
		// Meridian / wall: auto przechylone względem świata — gate world-up blokował jazdę.
		if (!meridian && !onWallSurface && Math.abs(this.getUpward().y) < 0.7)
			return;

		this._up.copy(this.surfaceNormal);
		this._fwd.copy(this.getForward());
		this._right.copy(this.getSideward());
		this.projectOnPlane(this._fwd, this._up);
		this.projectOnPlane(this._right, this._up);
		if (this._fwd.lengthSq() < 1e-6) return;
		this._fwd.normalize();
		this._right.normalize();

		const vel = this.getVelocity();
		const velUp = this._tmp.copy(this._up).multiplyScalar(vel.dot(this._up));
		const velPlane = this._vel.copy(vel).sub(velUp);

		let speedFwd = velPlane.dot(this._fwd);
		let speedRight = velPlane.dot(this._right);

		const accelUu = rlGroundDriveAccelUu(
			mpsToUu(speedFwd),
			this.lastThrottle,
			this.lastBoosting,
		);
		speedFwd += uuAccelToMps2(accelUu) * dt;
		const maxSpd = onWallSurface ? RL_CAR.wallMaxSpeed : RL_CAR.maxSpeed;
		speedFwd = THREE.MathUtils.clamp(
			speedFwd,
			-RL_CAR.reverseMaxSpeed,
			maxSpd,
		);

		const grip = THREE.MathUtils.lerp(
			RL_CAR.lateralGrip,
			RL_CAR.driftGrip,
			this.driftBlend,
		);
		speedRight *= Math.max(0, 1 - grip * dt);
		const driftingNow = this.driftBlend > 0.35;
		if (!driftingNow && Math.abs(speedRight) < 0.05) speedRight = 0;

		if (!driftingNow && Math.abs(this.lastThrottle) > 0.08) {
			const spd = Math.hypot(speedFwd, speedRight);
			const sign = speedFwd >= 0 ? 1 : -1;
			speedFwd = THREE.MathUtils.lerp(
				speedFwd,
				spd * sign,
				dt * RL_CAR.groundAlign,
			);
			speedRight = THREE.MathUtils.lerp(
				speedRight,
				0,
				dt * RL_CAR.groundAlign * 1.6,
			);
		}

		this._vel
			.copy(this._fwd)
			.multiplyScalar(speedFwd)
			.add(this._right.multiplyScalar(speedRight))
			.add(velUp);
		clampSpeedMps(this._vel, maxSpd);
		this.groundDriveLinvel = { x: this._vel.x, y: this._vel.y, z: this._vel.z };

		const av = this.rapierRigidBody.angvel();
		const speedAlong = Math.hypot(speedFwd, speedRight);
		const LOW_SPEED = 0.8;
		const steerScale =
			(THREE.MathUtils.lerp(1, RL_CAR.driftSteerMul, this.driftBlend)) *
			this.ballSteerMul;
		const surfaceYaw =
			onWallSurface || meridian
				? av.x * this._up.x + av.y * this._up.y + av.z * this._up.z
				: av.y;

		const setYawAround = (yawRate: number): void => {
			if (onWallSurface || meridian) {
				const n = this._up;
				const spin = av.x * n.x + av.y * n.y + av.z * n.z;
				const keepX = av.x - n.x * spin;
				const keepY = av.y - n.y * spin;
				const keepZ = av.z - n.z * spin;
				this.rapierRigidBody.setAngvel(
					{
						x: n.x * yawRate + keepX * 0.35,
						y: n.y * yawRate + keepY * 0.35,
						z: n.z * yawRate + keepZ * 0.35,
					},
					true,
				);
			} else {
				this.rapierRigidBody.setAngvel(
					{ x: av.x, y: yawRate, z: av.z },
					true,
				);
			}
		};

		if (Math.abs(this.lastYaw) < 0.01) {
			if (!driftingNow) {
				if (onWallSurface || meridian) {
					const n = this._up;
					const spin = av.x * n.x + av.y * n.y + av.z * n.z;
					this.rapierRigidBody.setAngvel(
						{
							x: av.x - n.x * spin,
							y: av.y - n.y * spin,
							z: av.z - n.z * spin,
						},
						true,
					);
				} else if (Math.abs(av.y) > 1e-4) {
					this.rapierRigidBody.setAngvel(
						{ x: av.x, y: 0, z: av.z },
						true,
					);
				}
			}
		} else if (speedAlong < LOW_SPEED) {
			setYawAround(this.lastYaw * RL_CAR.groundTurnInPlace * steerScale);
		} else {
			const target =
				rlTargetYawRate(mpsToUu(speedFwd), this.lastYaw) * steerScale;
			const maxDelta =
				RL_CAR.yawAngAccel * dt * (1 + 0.35 * this.driftBlend);
			const newYaw =
				surfaceYaw +
				THREE.MathUtils.clamp(target - surfaceYaw, -maxDelta, maxDelta);
			setYawAround(newYaw);
		}

		if (this.lastBoosting) {
			this.boostFuel = Math.max(0, this.boostFuel - dt * RL_CAR.boostDrain);
		}
	}

	private getCarAxes(): {
		right: THREE.Vector3;
		up: THREE.Vector3;
		forward: THREE.Vector3;
	} {
		this._right.copy(this.getSideward()).normalize();
		this._up.copy(this.getUpward()).normalize();
		this._fwd.copy(this.getForward()).normalize();
		return { right: this._right, up: this._up, forward: this._fwd };
	}

	private effectiveDodgeDeadzone(): number {
		if (!this.bodyTraitsEnabled) return RL_CAR.dodgeDeadzone;
		return pivotDodgeDeadzone(
			this.bodyTraits,
			RL_CAR.dodgeDeadzone,
			mpsToUu(this.getVelocity().length()),
		);
	}

	private filterStickInput(v: number): number {
		return Math.abs(v) >= this.effectiveDodgeDeadzone() ? v : 0;
	}

	private flattenCarOrientation(): void {
		const rot = this.rapierRigidBody.rotation();
		this._quat.set(rot.x, rot.y, rot.z, rot.w);
		const euler = new THREE.Euler().setFromQuaternion(this._quat, "YXZ");
		euler.x = 0;
		euler.z = 0;
		this._quat.setFromEuler(euler);
		this.rapierRigidBody.setRotation(
			{ x: this._quat.x, y: this._quat.y, z: this._quat.z, w: this._quat.w },
			true,
		);

		const av = this.rapierRigidBody.angvel();
		this.rapierRigidBody.setAngvel({ x: 0, y: av.y, z: 0 }, true);
	}

	private applyRlAirControl(dt: number): void {
		const axes = this.getCarAxes();
		let pitchIn = this.filterStickInput(this.lastThrottle);
		let yawIn = this.filterStickInput(this.lastYaw);
		let rollIn = this.lastRoll;

		/**
		 * RL: Powerslide / Air Roll na tym samym bindzie (Shift / L1).
		 * W powietrzu A/D → beczka (roll), nie yaw. Q/E nadal dodają roll.
		 */
		if (this.lastDrifting) {
			const stickRoll = this.filterStickInput(this.lastYaw);
			rollIn = THREE.MathUtils.clamp(rollIn + stickRoll, -1, 1);
			yawIn = 0;
		}

		if (this.neutralJumpLockLeft > 0) {
			rollIn = this.filterStickInput(rollIn);
		}

		let pitchScale = 1;
		if (this.flipPitchLockLeft > 0) {
			pitchScale = 0;
		} else if (this.flipActive) {
			pitchScale = rlFlipCancelPitchScale(
				this.flipRelTorquePitch,
				-pitchIn,
				this.flipElapsed,
				RL_CAR.flipNoCancelTime,
			);
		}

		const av = this.rapierRigidBody.angvel();
		const mass = RL_CAR.mass;
		const pitchOmega =
			av.x * axes.right.x + av.y * axes.right.y + av.z * axes.right.z;
		const yawOmega = av.x * axes.up.x + av.y * axes.up.y + av.z * axes.up.z;
		const rollOmega =
			av.x * axes.forward.x + av.y * axes.forward.y + av.z * axes.forward.z;

		this._force.set(0, 0, 0);

		// Pitch podczas flipa = wyłącznie applyFlipPhysics (setAngvel). Tu tylko damping zabiłby obrot.
		const allowPitchAirControl =
			!this.flipActive && this.flipPitchLockLeft <= 0;
		if (
			allowPitchAirControl &&
			(Math.abs(pitchIn) > 0.01 || Math.abs(pitchOmega) > 0.01)
		) {
			const pitchAccel = pitchIn * RL_CAR.pitchAngAccel * pitchScale;
			const pitchDamp =
				pitchOmega *
				RL_CAR.airPitchDamp *
				(1 - Math.min(1, Math.abs(pitchIn * pitchScale)));
			this._force.addScaledVector(axes.right, (pitchAccel - pitchDamp) * mass);
		}

		if (Math.abs(yawIn) > 0.01 || Math.abs(yawOmega) > 0.01) {
			const yawAccel = yawIn * RL_CAR.yawAngAccel;
			const yawDamp = yawOmega * RL_CAR.airYawDamp * (1 - Math.abs(yawIn));
			this._force.addScaledVector(axes.up, (yawAccel - yawDamp) * mass);
		}

		if (Math.abs(rollIn) > 0.01 || Math.abs(rollOmega) > 0.01) {
			const rollAccel = rollIn * RL_CAR.rollAngAccel;
			const rollDamp = rollOmega * RL_CAR.airRollDamp * (1 - Math.abs(rollIn));
			this._force.addScaledVector(axes.forward, (rollAccel - rollDamp) * mass);
		}

		const hasInput =
			Math.abs(pitchIn) > 0.01 ||
			Math.abs(yawIn) > 0.01 ||
			Math.abs(rollIn) > 0.01;

		this.rapierRigidBody.setAngularDamping(
			hasInput ? RL_CAR.airAngularDamp : RL_CAR.airAngularDamp * 2.8,
		);

		if (this._force.lengthSq() < 1e-4) return;

		this.rapierRigidBody.addTorque(
			{ x: this._force.x, y: this._force.y, z: this._force.z },
			true,
		);

		const maxAv = this.flipActive ? RL_CAR.flipMaxAngVel : RL_CAR.airMaxAngVel;
		const ang = this.rapierRigidBody.angvel();
		this._vel.set(ang.x, ang.y, ang.z);
		this.clampVec(this._vel, maxAv);
		if (
			Math.abs(this._vel.x - ang.x) > 1e-4 ||
			Math.abs(this._vel.y - ang.y) > 1e-4 ||
			Math.abs(this._vel.z - ang.z) > 1e-4
		) {
			this.rapierRigidBody.setAngvel(
				{ x: this._vel.x, y: this._vel.y, z: this._vel.z },
				true,
			);
		}

		void dt;
	}

	private applyAirThrottle(dt: number): void {
		const throttle = this.filterStickInput(this.lastThrottle);
		if (Math.abs(throttle) < 0.01 && !this.lastBoosting) return;

		if (this.flipActive) {
			const rot = this.rapierRigidBody.rotation();
			this._quat.set(rot.x, rot.y, rot.z, rot.w);
			carHorizontalForwardFromQuat(this._quat, this._fwd);
		} else {
			this._fwd.copy(this.getForward()).normalize();
		}
		let accelUu = rlAirThrottleAccelUu(throttle);
		if (this.lastBoosting && this.boostFuel > 0) {
			accelUu += rlAirBoostAccelUu() * Math.max(0.25, this.boostForceMul);
			this.boostFuel = Math.max(0, this.boostFuel - dt * RL_CAR.boostDrain);
		}
		if (Math.abs(accelUu) < 0.01) return;

		const accel = uuAccelToMps2(accelUu);
		this._vel.copy(this.rapierRigidBody.linvel());
		this._vel.addScaledVector(this._fwd, accel * dt);
		clampSpeedMps(this._vel, RL_CAR.maxSpeed);
		this.rapierRigidBody.setLinvel(
			{ x: this._vel.x, y: this._vel.y, z: this._vel.z },
			true,
		);
	}

	private processJumpPress(input: ControlInput): void {
		this.castSuspension();
		/** Dach / bok — szybki flip na koła zamiast zwykłego skoku / aerial. */
		if (this.tryPerformRecoveryFlip()) return;

		const groundedForJump =
			this.wheelsGrounded >= RL_HOVER.groundedMinWheels &&
			this.disableSuspensionTimer <= 0 &&
			this.jumpCooldown <= 0;
		if (groundedForJump) {
			this.performLiftOffJump();
			return;
		}
		if (!HOVER_SAFE_MODE) {
			this.handleJump(input);
		}
	}

	private handleJump(input: ControlInput): void {
		if (
			!this.isGrounded &&
			this.canSecondJump &&
			this.jumpCount === 1 &&
			this.dodgeWindowAge < RL_CAR.dodgeWindow
		) {
			// Ten sam deadzone co air control — ghost A/D nie robi diagonal flipa.
			const throttle = this.filterStickInput(input.forward());
			const yaw = this.filterStickInput(input.yaw());
			const inputMag = Math.abs(throttle) + Math.abs(yaw);
			const wantsFlip = inputMag >= this.effectiveDodgeDeadzone();
			if (wantsFlip) {
				this.performFlip(throttle, yaw);
			} else {
				this.performDoubleJump();
			}
			this.canSecondJump = false;
			this.jumpCount = 2;
			this.jumpHoldLeft = 0;
		}
	}

	private performDoubleJump(): void {
		this._up.copy(this.getUpward());
		const vel = this.getVelocity();
		const vn = vel.dot(this._up);
		if (vn < 0) vel.addScaledVector(this._up, -vn);
		vel.addScaledVector(this._up, RL_CAR.doubleJumpImpulse);
		clampSpeedMps(vel, RL_CAR.maxSpeed);
		this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);

		this.flattenCarOrientation();
		this.neutralJumpLockLeft = RL_CAR.neutralJumpLockTime;
	}

	private performFlip(throttle: number, yaw: number): void {
		const stick = { throttle, yaw };
		const { pitch, roll } = rlFlipRelTorque(stick);

		/**
		 * RL: dodge dostaje „kopa” z bieżącej orientacji — bez flatten.
		 * Flatten przed flipem zerował pitch z air control i wyglądał jak
		 * restart animacji od poziomu.
		 */
		const rot = this.rapierRigidBody.rotation();
		this._quat.set(rot.x, rot.y, rot.z, rot.w);
		carHorizontalForwardFromQuat(this._quat, this._fwd);
		carHorizontalRightFromForward(this._fwd, this._tmp);

		const forwardSpeedUu = mpsToUu(this.getVelocity().dot(this._fwd));
		if (pitch !== 0 || roll !== 0) {
			const { alongFwd, alongSide } = rlDodgeImpulseComponentsMps(
				stick,
				forwardSpeedUu,
			);
			const isMostlyBackflip =
				pitch < -0.1 && Math.abs(pitch) >= Math.abs(roll);
			const isCardinalFwdBack =
				Math.abs(pitch) >= Math.abs(roll) && Math.abs(pitch) > 0.1;
			const fwdImpulse = isMostlyBackflip
				? alongFwd * RL_CAR.backflipImpulseMul
				: alongFwd;
			const vel = this.getVelocity();
			if (isCardinalFwdBack) {
				const lateral = vel.dot(this._tmp);
				vel.addScaledVector(this._tmp, -lateral);
				this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
			}
			const spreadTicks = RL_CAR.flipImpulseSpreadTicks;
			const perFwd = fwdImpulse / spreadTicks;
			const perSide = alongSide / spreadTicks;
			if (spreadTicks > 1) {
				this.flipImpulseTicksLeft = spreadTicks - 1;
				this.flipImpulseFwdPerTick = perFwd;
				this.flipImpulseSidePerTick = perSide;
				this._flipImpulseFwdDir.copy(this._fwd);
				this._flipImpulseSideDir.copy(this._tmp);
			} else {
				this.flipImpulseTicksLeft = 0;
			}
			vel.addScaledVector(this._fwd, perFwd);
			vel.addScaledVector(this._tmp, perSide);
			clampSpeedMps(vel, RL_CAR.maxSpeed);
			this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
		}

		this.flipRelTorquePitch = pitch;
		this.flipRelTorqueRoll = roll;
		this.flipPitchRateMul =
			pitch < -0.1 && Math.abs(pitch) >= Math.abs(roll)
				? RL_CAR.backflipPitchTorqueMul
				: 1;
		this.flipActive = true;
		this.flipTimer = RL_CAR.flipDuration;
		this.flipElapsed = 0;
		this.flipGravityOffLeft = RL_CAR.flipGravityOffDuration;
		// Raycasty kół nie mogą „uziemić” auta w połowie flipa (nos w dół ≈ 90°).
		this.disableSuspensionTimer = Math.max(
			this.disableSuspensionTimer,
			RL_CAR.flipDuration,
		);
	}

	private applyFlipPhysics(dt: number): void {
		if (this.flipImpulseTicksLeft > 0) {
			this.flipImpulseTicksLeft--;
			const vel = this.getVelocity();
			vel.addScaledVector(this._flipImpulseFwdDir, this.flipImpulseFwdPerTick);
			vel.addScaledVector(
				this._flipImpulseSideDir,
				this.flipImpulseSidePerTick,
			);
			clampSpeedMps(vel, RL_CAR.maxSpeed);
			this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
		}

		if (this.jumpStickyLeft > 0) {
			this.jumpStickyLeft = Math.max(0, this.jumpStickyLeft - dt);
			this._force.set(0, -RL_CAR.stickyForce * RL_CAR.mass, 0);
			this.rapierRigidBody.addForce(
				{ x: this._force.x, y: this._force.y, z: this._force.z },
				true,
			);
		}

		if (this.flipGravityOffLeft > 0) {
			this.flipGravityOffLeft -= dt;
			this._force.set(0, RL_CAR.mass * Math.abs(WORLD_GRAVITY), 0);
			this.rapierRigidBody.addForce(
				{ x: this._force.x, y: this._force.y, z: this._force.z },
				true,
			);
		} else if (this.gravityScale < 0.999) {
			const lift =
				RL_CAR.mass * Math.abs(WORLD_GRAVITY) * (1 - this.gravityScale);
			this.rapierRigidBody.addForce({ x: 0, y: lift, z: 0 }, true);
		}

		if (!this.flipActive) return;

		this.flipTimer -= dt;
		this.flipElapsed += dt;

		const pitchInput = -this.lastThrottle;
		const pitchScale = rlFlipCancelPitchScale(
			this.flipRelTorquePitch,
			pitchInput,
			this.flipElapsed,
			RL_CAR.flipNoCancelTime,
		);

		const right = this.getSideward();
		const forward = this.getForward();
		const up = this.getUpward();
		const pitchRate =
			this.flipRelTorquePitch *
			pitchScale *
			RL_CAR.flipMaxAngVel *
			this.flipPitchRateMul;
		const rollRate = this.flipRelTorqueRoll * RL_CAR.flipMaxAngVel;

		/** Zachowaj składową wzdłuż „up” (yaw) — dodge nie zeruje całego spinu. */
		const av = this.rapierRigidBody.angvel();
		const yawKeep = av.x * up.x + av.y * up.y + av.z * up.z;
		this._vel
			.copy(right)
			.multiplyScalar(pitchRate)
			.addScaledVector(forward, rollRate)
			.addScaledVector(up, yawKeep);
		this.rapierRigidBody.setAngvel(
			{ x: this._vel.x, y: this._vel.y, z: this._vel.z },
			true,
		);

		if (this.flipElapsed > RL_CAR.flipVertDampStart) {
			const vel = this.getVelocity();
			const mul = RL_CAR.flipVertDampMul ** (dt * RL_CAR.physicsTickHz);
			const dampUp = this.flipElapsed < RL_CAR.flipVertDampEnd;
			// RL: damp wzdłuż świata Y, nie pochylonego „up” auta (przy 90° pitch inaczej nurkuje).
			const vy = vel.y;
			if (vy < 0 || dampUp) {
				vel.y = vy * mul;
				this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
			}
		}

		if (this.flipTimer <= 0) {
			this.flipActive = false;
			this.flipPitchLockLeft = RL_CAR.flipPitchLockExtra;
			// Flip kończy napęd torque — resztkowy obrót zostaje (RL). Pełne
			// odejmowanie pitch/roll omega dawało wizualny „freeze” ~270°.
		}
	}

	private applyJumpHold(held: boolean, dt: number): void {
		if (!held || this.jumpHoldLeft <= 0) return;
		this._up.copy(this.getUpward());
		if (this.getVelocity().dot(this._up) <= 0) {
			this.jumpHoldLeft = 0;
			return;
		}
		this.jumpHoldLeft -= dt;
		this._force
			.copy(this._up)
			.multiplyScalar(RL_CAR.jumpHoldAccel * RL_CAR.mass);
		this.rapierRigidBody.addForce(
			{ x: this._force.x, y: this._force.y, z: this._force.z },
			true,
		);
		/** Boost tylko w applyAirThrottle — bez podwójnego drainu / accel w górę. */
	}

	private syncGroundJumpState(): void {
		if (
			this.jumpCount <= 0 ||
			this.wheelsCompressing < RL_HOVER.groundedMinWheels ||
			this.wallJumpDetachLeft > 0
		) {
			return;
		}
		const flatOk =
			isMeridianArenaActive() ||
			this.surfaceNormal.y >= RL_CAR.wallNormalFlatThreshold;
		const wallOk =
			this.isOnWallOrRamp() &&
			this.surfaceNormal.y < RL_CAR.wallNormalFlatThreshold;
		if (!flatOk && !wallOk) return;

		const vel = this.getVelocity();
		const alongN = isMeridianArenaActive()
			? vel.dot(this.surfaceNormal)
			: flatOk
				? vel.y
				: vel.dot(this.surfaceNormal);
		if (Math.abs(alongN) < 1.0) {
			this.resetJumpState();
		}
	}

	private resetJumpState(): void {
		this.jumpCount = 0;
		this.dodgeWindowAge = 0;
		this.canSecondJump = true;
		this.flipActive = false;
		this.flipTimer = 0;
		this.flipElapsed = 0;
		this.flipRelTorquePitch = 0;
		this.flipRelTorqueRoll = 0;
		this.flipPitchRateMul = 1;
		this.flipPitchLockLeft = 0;
		this.neutralJumpLockLeft = 0;
		this.jumpStickyLeft = 0;
		this.jumpHoldLeft = 0;
		this.disableSuspensionTimer = 0;
		this.wallJumpDetachLeft = 0;
	}

	private lockGroundPitchRoll(): void {
		if (this.wheelsGrounded < RL_HOVER.groundedMinWheels) return;
		if (Math.abs(this.getUpward().y) < 0.7) return;
		if (
			!this.isGrounded ||
			this.surfaceNormal.y < RL_CAR.wallNormalFlatThreshold
		)
			return;

		const av = this.rapierRigidBody.angvel();
		if (Math.abs(av.x) > 1e-4 || Math.abs(av.z) > 1e-4) {
			this.rapierRigidBody.setAngvel({ x: 0, y: av.y, z: 0 }, true);
		}

		const rot = this.rapierRigidBody.rotation();
		this._quat.set(rot.x, rot.y, rot.z, rot.w);
		const euler = new THREE.Euler().setFromQuaternion(this._quat, "YXZ");
		if (Math.abs(euler.x) > 0.001 || Math.abs(euler.z) > 0.001) {
			euler.x = 0;
			euler.z = 0;
			this._quat.setFromEuler(euler);
			this.rapierRigidBody.setRotation(
				{ x: this._quat.x, y: this._quat.y, z: this._quat.z, w: this._quat.w },
				true,
			);
		}
	}

	private projectOnPlane(v: THREE.Vector3, n: THREE.Vector3): void {
		v.addScaledVector(n, -v.dot(n));
	}

	private clampVec(v: THREE.Vector3, max: number): void {
		const len = v.length();
		if (len > max) v.multiplyScalar(max / len);
	}

	private tryTurtleRecovery(): void {
		if (this.recoveryCooldown > 0) return;
		if (this.getUpward().y >= -0.2) return;

		const mass = this.rapierRigidBody.mass();

		this._fwd.copy(this.getForward()).normalize();
		const rollSign = this.getSideward().y >= 0 ? 1 : -1;
		const rollImpulse = mass * 12.0 * rollSign;
		this.rapierRigidBody.applyTorqueImpulse(
			{
				x: this._fwd.x * rollImpulse,
				y: this._fwd.y * rollImpulse,
				z: this._fwd.z * rollImpulse,
			},
			true,
		);

		this.recoveryCooldown = 1.0;
		this.disableSuspensionTimer = 0.15;
		this.isGrounded = false;
	}

	/**
	 * PPM na dachu / boku — flip na koła względem podłoża.
	 * Meridian: „podłoże” = styczna sfery (world −Y na suficie to NORMALNA jazda).
	 */
	private tryPerformRecoveryFlip(): boolean {
		if (this.recoveryCooldown > 0 || this.flipActive) return false;

		if (isMeridianArenaActive()) {
			const n = this.surfaceNormal;
			const surfaceAlign = this.getUpward().dot(n);
			// Na kołach względem sfery (także „sufit”) — zwykły skok / dodge.
			if (surfaceAlign >= 0.35) return false;
			if (surfaceAlign > -0.3) return false;
			this.performGroundRecoveryFlip(n);
			return true;
		}

		/** Ściana / sufit — recovery względem normalnej powierzchni, nie world +Y. */
		if (
			this.isOnWallOrRamp() &&
			this.surfaceNormal.y < RL_CAR.wallNormalFlatThreshold
		) {
			const n = this.surfaceNormal;
			const surfaceAlign = this.getUpward().dot(n);
			if (surfaceAlign >= 0.35) return false;
			if (surfaceAlign > -0.25) return false;
			this.performGroundRecoveryFlip(n);
			return true;
		}

		const upY = this.getUpward().y;
		if (upY >= 0.55) return false;

		const pos = this.rapierRigidBody.translation();
		const nearGround =
			this.wheelsGrounded >= 1 ||
			this.isGrounded ||
			pos.y < RL_CAR.hitboxHalfY * 4;

		if (!nearGround) {
			if (upY < -0.2) {
				/** Nie walcz z ceiling stick — turtle tylko w powietrzu. */
				if (this.surfaceNormal.y < 0.25) return false;
				this.tryTurtleRecovery();
				return true;
			}
			return false;
		}

		this.performGroundRecoveryFlip(this._carUp.set(0, 1, 0));
		return true;
	}

	/** Impuls + angvel w stronę targetUp (world +Y albo normalna Meridian). */
	private performGroundRecoveryFlip(targetUp?: THREE.Vector3): void {
		const upTarget = targetUp ?? this._carUp.set(0, 1, 0);
		this._up.copy(this.getUpward()).normalize();
		this._tmp.crossVectors(this._up, upTarget);
		if (this._tmp.lengthSq() < 0.01) {
			this._tmp.copy(this.getForward()).normalize();
		} else {
			this._tmp.normalize();
		}

		const align = THREE.MathUtils.clamp(this._up.dot(upTarget), -1, 1);
		const tilt = Math.acos(align);
		const mass = this.rapierRigidBody.mass();
		const torqueMag = mass * (16 + tilt * 12);
		this.rapierRigidBody.applyTorqueImpulse(
			{
				x: this._tmp.x * torqueMag,
				y: this._tmp.y * torqueMag,
				z: this._tmp.z * torqueMag,
			},
			true,
		);

		const rate = 8.5 + tilt * 5;
		this.rapierRigidBody.setAngvel(
			{
				x: this._tmp.x * rate,
				y: this._tmp.y * rate,
				z: this._tmp.z * rate,
			},
			true,
		);

		const vel = this.getVelocity();
		if (isMeridianArenaActive()) {
			vel.multiplyScalar(0.7);
			const along = vel.dot(upTarget);
			vel.addScaledVector(upTarget, Math.max(0, 3.4 - along));
		} else {
			vel.x *= 0.55;
			vel.z *= 0.55;
			vel.y = Math.max(vel.y, 0) + 3.4;
		}
		clampSpeedMps(vel, RL_CAR.maxSpeed);
		this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);

		this.recoveryCooldown = 0.5;
		this.disableSuspensionTimer = 0.4;
		this.isGrounded = false;
		this.resetJumpState();
	}

	private recoverFromCrash(): void {
		const t = this.rapierRigidBody.translation();
		const v = this.rapierRigidBody.linvel();
		const sphere = getMeridianSphere();
		const outOfBounds = sphere
			? t.y < -5 ||
				Math.hypot(
					t.x - sphere.center.x,
					t.y - sphere.center.y,
					t.z - sphere.center.z,
				) >
					sphere.radius + 25
			: t.y < -5 || Math.abs(t.x) > 100;
		if (
			!Number.isFinite(t.x) ||
			!Number.isFinite(t.y) ||
			!Number.isFinite(t.z) ||
			outOfBounds
		) {
			this.rapierRigidBody.setTranslation(
				{ x: this.recoveryPos.x, y: this.recoveryPos.y, z: this.recoveryPos.z },
				true,
			);
			this.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
			this.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
			this.resetJumpState();
		} else if (
			!Number.isFinite(v.x) ||
			!Number.isFinite(v.y) ||
			!Number.isFinite(v.z)
		) {
			this.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
			this.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		}
	}
}

export default RocketCar;
