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
	rlGroundDriveAccelUu,
	rlTargetYawRate,
	uuAccelToMps2,
} from "../util/rlPhysics";
import {
	SimulatedControlInput,
	type SimulatedInput,
} from "../util/SimulatedInput";
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
	boostFuel = 1;

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
	private flipGravityOffLeft = 0;
	private flipAxisWorld = new THREE.Vector3();
	private flipOmega = 0;
	private flipVertUpTicksLeft = 0;
	private jumpCooldown = 0;
	private disableSuspensionTimer = 0;
	private recoveryCooldown = 0;
	private debugFrame = 0;

	private boosting = false;
	private readonly surfaceNormal = new THREE.Vector3(0, 1, 0);

	private lastThrottle = 0;
	private lastYaw = 0;
	private lastRoll = 0;
	private lastBoosting = false;
	private lastDrifting = false;
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
	private readonly _force = new THREE.Vector3();
	private readonly _vel = new THREE.Vector3();
	private readonly _velAt = new THREE.Vector3();
	private readonly _fwd = new THREE.Vector3();
	private readonly _right = new THREE.Vector3();
	private readonly _up = new THREE.Vector3();
	private readonly _tmp = new THREE.Vector3();
	private readonly _quat = new THREE.Quaternion();
	private readonly _carUp = new THREE.Vector3();

	private suspensionViz: SuspensionVisualizer | null = null;
	private physicsStepCounter = 0;
	private lastSuspensionForceMag = 0;
	private groundDriveLinvel: { x: number; y: number; z: number } | null = null;

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

	control(input: ControlInput, dt: number): void {
		this.lastThrottle = input.forward();
		this.lastYaw = input.yaw();
		this.lastRoll = HOVER_SAFE_MODE ? 0 : input.roll();
		this.lastBoosting = HOVER_SAFE_MODE
			? false
			: input.isBoosting() && this.boostFuel > 0;
		this.lastDrifting = HOVER_SAFE_MODE ? false : input.isShiftDown();
		this.boosting = this.lastBoosting;

		this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

		this.recoveryCooldown = Math.max(0, this.recoveryCooldown - dt);

		if (input.consumeJump()) {
			this.castSuspension();
			if (this.getUpward().y < -0.2) {
				this.tryTurtleRecovery();
			} else {
				const groundedForJump =
					this.wheelsGrounded >= RL_HOVER.groundedMinWheels &&
					this.disableSuspensionTimer <= 0 &&
					this.jumpCooldown <= 0;
				if (groundedForJump) {
					this.performLiftOffJump();
				} else if (!HOVER_SAFE_MODE) {
					this.handleJump(input);
				}
			}
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
			if (!this.lastBoosting) {
				const rate = this.isGrounded
					? 1
					: RL_CAR.boostRegenAir / RL_CAR.boostRegenGround;
				this.boostFuel = Math.min(
					1,
					this.boostFuel + dt * RL_CAR.boostRegenGround * rate,
				);
			}
		}

		this.recoverFromCrash();
	}

	/** Wejście bota / AI — ten sam pipeline co gracz (ControlInput). */
	updateInputs(input: SimulatedInput, dt: number): void {
		this.control(new SimulatedControlInput(input), dt);
	}

	/** Wywoływane przed każdym krokiem Rapier (120 Hz). */
	integrateHover(dt: number): void {
		this.disableSuspensionTimer = Math.max(0, this.disableSuspensionTimer - dt);

		this.castSuspension();
		this.updateGroundedState();

		const isVerticalStand = Math.abs(this.getForward().y) > 0.85;
		const stableDrive =
			this.isGrounded &&
			Math.abs(this.getUpward().y) >= 0.7 &&
			!isVerticalStand;

		if (stableDrive) {
			this.syncGroundJumpState();
			this.applySuspensionForces();
			this.applyGroundDrive(dt);
			this.lockGroundPitchRoll();
		} else {
			if (
				this.wheelsGrounded > 0 &&
				this.disableSuspensionTimer <= 0 &&
				this.isGrounded
			) {
				this.applySuspensionForces();
			}
			this.applyAerialTorqueControl(dt);
			if (!HOVER_SAFE_MODE) {
				this.applyAirThrottle(dt);
				this.applyFlipPhysics(dt);
			}
			this.rapierRigidBody.setLinearDamping(RL_CAR.airLinearDamp);
		}

		this.recoverFromCrash();
		this.logHoverTelemetry();
	}

	/** Wywoływane po world.step() — kinematyczna jazda po tarcie Rapiera. */
	finalizeHoverStep(): void {
		const isVerticalStand = Math.abs(this.getForward().y) > 0.85;
		const stableDrive =
			this.isGrounded &&
			Math.abs(this.getUpward().y) >= 0.7 &&
			!isVerticalStand;
		if (stableDrive && this.groundDriveLinvel) {
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

	getSurfaceNormal(): THREE.Vector3 {
		return this.surfaceNormal;
	}

	isOnGround(): boolean {
		return this.isGrounded;
	}

	/** Liczba kół na powierzchni (0–4) — m.in. dla kamery (air flip lock). */
	getWheelsGroundedCount(): number {
		return this.wheelsGrounded;
	}

	isOnWallOrRamp(): boolean {
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
				if (wh.normal.y < 0) wh.normal.negate();
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

		this.debugFrame = (this.debugFrame || 0) + 1;
		if (this.debugFrame % 60 === 0) {
			console.log(
				`[RAYCAST_DUMP] hitCount: ${hitCount}, wheelsGrounded: ${this.wheelsGrounded}, isGrounded: ${this.isGrounded}, disableSuspOff: ${this.disableSuspensionTimer.toFixed(3)}s`,
			);
		}
		if (hitCount > 0) {
			this.surfaceNormal
				.copy(normalAcc.multiplyScalar(1 / hitCount))
				.normalize();
		} else {
			this.surfaceNormal.set(0, 1, 0);
		}
	}

	/**
	 * „Na ziemi” tylko przy ściśniętej zawieszeniu i wolnym lądowaniu —
	 * raycast w zasięgu podczas szybkiego opadu nie wyłącza boosta w powietrzu.
	 */
	private updateGroundedState(): void {
		if (this.disableSuspensionTimer > 0) {
			this.isGrounded = false;
			return;
		}

		const vel = this.rapierRigidBody.linvel();
		const n = this.surfaceNormal;
		const approach = -(vel.x * n.x + vel.y * n.y + vel.z * n.z);

		this.isGrounded =
			this.wheelsCompressing >= RL_HOVER.groundedMinWheels &&
			approach < GROUND_APPROACH_MAX_MPS;
	}

	private performLiftOffJump(): void {
		this._up.copy(this.getUpward()).normalize();
		const vel = this.getVelocity();
		const vn = vel.dot(this._up);
		if (vn < 0) vel.addScaledVector(this._up, -vn);
		vel.addScaledVector(this._up, RL_CAR.jumpImpulse);
		clampSpeedMps(vel, RL_CAR.maxSpeed);
		this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);

		this.disableSuspensionTimer = 0.2;
		this.jumpCooldown = 1.5;
		this.isGrounded = false;
		this.jumpCount = 1;
		this.dodgeWindowAge = 0;
		this.jumpHoldLeft = RL_CAR.jumpHoldMax;
		this.wheelsGrounded = 0;
		this.wheelsCompressing = 0;
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

		if (!HOVER_SAFE_MODE && this.isOnWallOrRamp()) {
			const mass = RL_CAR.mass;
			this._force.set(0, mass * Math.abs(WORLD_GRAVITY), 0);
			body.addForce(
				{ x: this._force.x, y: this._force.y, z: this._force.z },
				true,
			);
			this._force
				.copy(this.surfaceNormal)
				.multiplyScalar(-RL_HOVER.wallStickAccel * mass);
			body.addForce(
				{ x: this._force.x, y: this._force.y, z: this._force.z },
				true,
			);
		}

		this.rapierRigidBody.setLinearDamping(RL_CAR.linearDamp);
		this.rapierRigidBody.setAngularDamping(RL_CAR.angularDamp);
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

	private applyGroundDrive(dt: number): void {
		if (this.wheelsGrounded < RL_HOVER.groundedMinWheels) return;
		if (Math.abs(this.getUpward().y) < 0.7) return;

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
		speedFwd = THREE.MathUtils.clamp(
			speedFwd,
			-RL_CAR.reverseMaxSpeed,
			RL_CAR.maxSpeed,
		);

		const grip = this.lastDrifting ? RL_CAR.driftGrip : RL_CAR.lateralGrip;
		speedRight *= Math.max(0, 1 - grip * dt);
		if (!this.lastDrifting && Math.abs(speedRight) < 0.05) speedRight = 0;

		if (!this.lastDrifting && Math.abs(this.lastThrottle) > 0.08) {
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
		clampSpeedMps(this._vel, RL_CAR.maxSpeed);
		this.groundDriveLinvel = { x: this._vel.x, y: this._vel.y, z: this._vel.z };

		if (!this.lastDrifting) {
			const av = this.rapierRigidBody.angvel();
			const linvel = this.rapierRigidBody.linvel();
			const speedXZ = Math.hypot(linvel.x, linvel.z);
			const GROUND_TURN_IN_PLACE = 3.5;
			const LOW_SPEED_XZ = 0.8;

			if (Math.abs(this.lastYaw) < 0.01) {
				if (Math.abs(av.y) > 1e-4) {
					this.rapierRigidBody.setAngvel({ x: av.x, y: 0, z: av.z }, true);
				}
			} else if (speedXZ < LOW_SPEED_XZ) {
				// Obrót w miejscu — bezpośrednio w osi Y (A=+, D=-)
				const targetYaw =
					this.lastYaw * GROUND_TURN_IN_PLACE * this.ballSteerMul;
				this.rapierRigidBody.setAngvel(
					{ x: av.x, y: targetYaw, z: av.z },
					true,
				);
			} else {
				const target =
					rlTargetYawRate(mpsToUu(speedFwd), this.lastYaw) * this.ballSteerMul;
				const maxDelta = RL_CAR.yawAngAccel * dt;
				const newY =
					av.y + THREE.MathUtils.clamp(target - av.y, -maxDelta, maxDelta);
				this.rapierRigidBody.setAngvel({ x: av.x, y: newY, z: av.z }, true);
			}
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

	private applyAerialTorqueControl(_dt: number): void {
		if (this.flipActive) {
			this.rapierRigidBody.setAngularDamping(RL_CAR.airAngularDamp);
			return;
		}

		const axes = this.getCarAxes();
		const pitchIn = this.lastThrottle;
		const yawIn = this.lastYaw;
		const rollIn = this.lastRoll;
		const hasInput =
			Math.abs(pitchIn) > 0.01 ||
			Math.abs(yawIn) > 0.01 ||
			Math.abs(rollIn) > 0.01;

		if (!hasInput) {
			this.rapierRigidBody.setAngularDamping(10.0);
			return;
		}

		this.rapierRigidBody.setAngularDamping(RL_CAR.airAngularDamp);

		const pitchRate = 4.5;
		const yawRate = 4.5;
		const rollRate = 3.5;
		const isVertical = Math.abs(axes.forward.y) > 0.85;
		const verticalRollRate = yawRate * 1.35;

		this._vel.set(0, 0, 0);

		if (pitchIn > 0.01) {
			this._vel.addScaledVector(axes.right, pitchRate);
		} else if (pitchIn < -0.01) {
			this._vel.addScaledVector(axes.right, -pitchRate);
		}

		if (isVertical) {
			if (yawIn > 0.01) {
				this._vel.addScaledVector(axes.forward, verticalRollRate);
			} else if (yawIn < -0.01) {
				this._vel.addScaledVector(axes.forward, -verticalRollRate);
			}
		} else {
			if (yawIn > 0.01) {
				this._vel.addScaledVector(axes.up, yawRate);
			} else if (yawIn < -0.01) {
				this._vel.addScaledVector(axes.up, -yawRate);
			}
		}

		if (rollIn > 0.01) {
			this._vel.addScaledVector(axes.forward, rollRate);
		} else if (rollIn < -0.01) {
			this._vel.addScaledVector(axes.forward, -rollRate);
		}

		this.clampVec(this._vel, RL_CAR.airMaxAngVel);
		this.rapierRigidBody.setAngvel(
			{ x: this._vel.x, y: this._vel.y, z: this._vel.z },
			true,
		);
	}

	private applyAirThrottle(dt: number): void {
		if (Math.abs(this.lastThrottle) < 0.01 && !this.lastBoosting) return;

		this._fwd.copy(this.getForward()).normalize();
		let accelUu = rlAirThrottleAccelUu(this.lastThrottle);
		if (this.lastBoosting && this.boostFuel > 0) {
			accelUu += rlAirBoostAccelUu();
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

	private handleJump(input: ControlInput): void {
		if (
			this.jumpCount === 0 &&
			this.wheelsGrounded >= RL_HOVER.groundedMinWheels &&
			this.disableSuspensionTimer <= 0 &&
			this.jumpCooldown <= 0
		) {
			this.performLiftOffJump();
			return;
		}

		if (
			!this.isGrounded &&
			this.canSecondJump &&
			this.jumpCount === 1 &&
			this.dodgeWindowAge < RL_CAR.dodgeWindow
		) {
			const throttle =
				Math.abs(input.forward()) > 0.2 ? input.forward() : this.lastThrottle;
			const yaw = Math.abs(input.yaw()) > 0.2 ? input.yaw() : this.lastYaw;
			const wantsFlip =
				Math.hypot(throttle, yaw) > 0.2 ||
				Math.hypot(this.lastThrottle, this.lastYaw) > 0.2;
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
	}

	private performFlip(throttle: number, yaw: number): void {
		let t = throttle;
		let y = yaw;
		if (Math.hypot(t, y) < 0.2) {
			t = this.lastThrottle;
			y = this.lastYaw;
		}

		const rot = this.rapierRigidBody.rotation();
		this._quat.set(rot.x, rot.y, rot.z, rot.w);
		carHorizontalForwardFromQuat(this._quat, this._fwd);
		carHorizontalRightFromForward(this._fwd, this._tmp);

		const forwardSpeedUu = mpsToUu(this.getVelocity().dot(this._fwd));
		const { alongFwd, alongSide } = rlDodgeImpulseComponentsMps(
			{ throttle: t, yaw: y },
			forwardSpeedUu,
		);

		const vel = this.getVelocity();
		vel.addScaledVector(this._fwd, alongFwd);
		vel.addScaledVector(this._tmp, alongSide);
		clampSpeedMps(vel, RL_CAR.maxSpeed);
		this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);

		const fwd = this.getForward();
		const side = this.getSideward();
		const absT = Math.abs(t);
		const absY = Math.abs(y);
		const flipAxis = this._force;
		let flipSign = -1;

		if (absY > 0.01 && absY >= absT) {
			flipAxis.copy(fwd).multiplyScalar(Math.sign(y));
			flipSign = -Math.sign(y);
		} else if (t < -0.01) {
			flipAxis.copy(side);
			flipSign = 1;
		} else {
			flipAxis.copy(side).multiplyScalar(-1);
			flipSign = -1;
		}
		flipAxis.normalize();

		this.flipAxisWorld.copy(flipAxis);
		this.flipOmega =
			flipSign *
			Math.min((2 * Math.PI) / RL_CAR.flipDuration, RL_CAR.flipMaxAngVel);
		this._vel.copy(this.flipAxisWorld).multiplyScalar(this.flipOmega);
		this.rapierRigidBody.setAngvel(
			{ x: this._vel.x, y: this._vel.y, z: this._vel.z },
			true,
		);

		this.flipActive = true;
		this.flipTimer = RL_CAR.flipDuration;
		this.flipGravityOffLeft = RL_CAR.flipGravityOffDuration;
		this.flipVertUpTicksLeft = RL_CAR.flipVertUpDampTicks;
	}

	private applyFlipPhysics(dt: number): void {
		if (this.flipGravityOffLeft > 0) {
			this.flipGravityOffLeft -= dt;
			this._force.set(0, RL_CAR.mass * Math.abs(WORLD_GRAVITY), 0);
			this.rapierRigidBody.addForce(
				{ x: this._force.x, y: this._force.y, z: this._force.z },
				true,
			);
		}

		if (!this.flipActive) return;

		this.flipTimer -= dt;
		this._vel.copy(this.flipAxisWorld).multiplyScalar(this.flipOmega);
		this.rapierRigidBody.setAngvel(
			{ x: this._vel.x, y: this._vel.y, z: this._vel.z },
			true,
		);

		const elapsed = RL_CAR.flipDuration - this.flipTimer;
		if (elapsed > RL_CAR.flipVertDampStart) {
			const vel = this.getVelocity();
			const up = this.getUpward();
			const vn = vel.dot(up);
			const mul = RL_CAR.flipVertDampMul ** (dt * RL_CAR.physicsTickHz);
			if (vn < 0) {
				vel.addScaledVector(up, vn * (mul - 1));
				this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
			} else if (vn > 0 && this.flipVertUpTicksLeft > 0) {
				vel.addScaledVector(up, vn * (mul - 1));
				this.rapierRigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
				this.flipVertUpTicksLeft -= dt * RL_CAR.physicsTickHz;
			}
		}

		if (this.flipTimer <= 0) {
			this.flipActive = false;
			const av = this.rapierRigidBody.angvel();
			this._vel.set(av.x, av.y, av.z);
			this.clampVec(this._vel, RL_CAR.airMaxAngVel);
			this.rapierRigidBody.setAngvel(
				{ x: this._vel.x, y: this._vel.y, z: this._vel.z },
				true,
			);
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
	}

	private syncGroundJumpState(): void {
		if (
			this.jumpCount > 0 &&
			this.surfaceNormal.y >= RL_CAR.wallNormalFlatThreshold
		) {
			const vy = this.getVelocity().y;
			if (Math.abs(vy) < 1.2) {
				this.resetJumpState();
			}
		}
	}

	private resetJumpState(): void {
		this.jumpCount = 0;
		this.dodgeWindowAge = 0;
		this.canSecondJump = true;
		this.flipActive = false;
		this.flipTimer = 0;
		this.flipVertUpTicksLeft = 0;
		this.jumpHoldLeft = 0;
		this.disableSuspensionTimer = 0;
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

	private recoverFromCrash(): void {
		const t = this.rapierRigidBody.translation();
		const v = this.rapierRigidBody.linvel();
		if (
			!Number.isFinite(t.x) ||
			!Number.isFinite(t.y) ||
			!Number.isFinite(t.z) ||
			t.y < -5 ||
			Math.abs(t.x) > 100
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
