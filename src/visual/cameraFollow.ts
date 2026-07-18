import * as THREE from "three";

import { RL_CAMERA, RL_CAR } from "../util/rlConstants";
import { carHorizontalForwardFromQuat } from "../util/rlPhysics";
import {
	clampPointInsideMeridian,
	computeMeridianCamLookAt,
	computeMeridianCamTarget,
	MERIDIAN_CAM,
	meridianCameraUp,
} from "./meridianCamera";
import { isMeridianArenaActive } from "./meridianArena";

export const CAMERA_DISTANCE = RL_CAMERA.distance;
export const CAMERA_HEIGHT = RL_CAMERA.height;
export const CAMERA_ANGLE = RL_CAMERA.angleDeg;
export const CAMERA_STIFFNESS = RL_CAMERA.stiffness;

export const CAM_MAX_DIST_XZ = 12;
export const CAM_MAX_DIST_3D = 15;
export const CAM_NDC_MARGIN = 0.12;

/** Bezpieczna strefa auta w NDC — miękkie centrowanie, bez snapów. */
export const PLAYER_FRAME = {
	/** Preferowany środek kadru (NDC Y) — auto lekko powyżej środka. */
	preferY: 0.4,
	minY: 0.28,
	maxY: 0.52,
	maxAbsX: 0.28,
	/** Siła korekty lookAt w poziomie (world units per NDC error). */
	panGainX: 14,
	/** Pionowa korekta — słabsza, żeby nie topić horyzontu przy boost. */
	panGainY: 5.5,
	/** Przy max speed: ile % pionowej korekty zostaje (0–1). */
	panGainYAtSpeed: 0.35,
	/** Miękkie dociągnięcie do środka nawet wewnątrz strefy (0–1). */
	softCenterPull: 0.35,
	/** Max trwały offset lookAt (m) — bezpieczny limit anty-jitter. */
	maxLookOffsetM: 2.2,
	/** Wyprzedzenie kamery w kierunku jazdy (m) — tylko dla applySpeedLeadToTarget. */
	leadMin: 0.35,
	leadMax: 1.6,
	leadBoostMul: 1.25,
	/**
	 * Maksymalne nachylenie kamery w dół (stopnie).
	 * Naturalny chase RL ≈ −15°; framing/ball nie mogą pójść stromiej niż to.
	 */
	maxPitchDownDeg: -20,
} as const;

/** @deprecated Użyj CAMERA_STIFFNESS — zachowane dla diagnostyki. */
export const CAM_POS_LERP = CAMERA_STIFFNESS;

export type ChaseCameraState = {
	initialized: boolean;
	currentHorizontalFov: number;
	shakeIntensity: number;
	lastFlatForward: THREE.Vector3;
	/** Free cam: zamrożony kadr na starcie flipa (RL — kamera nie przechyla się z autem). */
	flipCamActive: boolean;
	flipCamLookY: number;
	flipCamHeightY: number;
	/** Wygładzony punkt patrzenia — bez instant lookAt co klatkę. */
	smoothedLookAt: THREE.Vector3;
	/** Prędkość dla smoothDamp pozycji kamery. */
	posVelocity: THREE.Vector3;
	/** Kumulacja błędu kadru (NDC) — do wygładzenia. */
	framePan: THREE.Vector3;
	/**
	 * Trwały offset lookAt (world) po lerp — framing nie walczy z ball-look.
	 * Clampowany do maxLookOffsetM.
	 */
	frameLookOffset: THREE.Vector3;
};

export function horizontalFovToVertical(
	horizontalDeg: number,
	aspect: number,
): number {
	const hRad = THREE.MathUtils.degToRad(horizontalDeg);
	const vRad = 2 * Math.atan(Math.tan(hRad * 0.5) / aspect);
	return THREE.MathUtils.radToDeg(vRad);
}

export function createChaseCameraState(
	baseHorizontalFov: number = RL_CAMERA.horizontalFov,
): ChaseCameraState {
	return {
		initialized: false,
		currentHorizontalFov: baseHorizontalFov,
		shakeIntensity: 0,
		lastFlatForward: new THREE.Vector3(0, 0, 1),
		flipCamActive: false,
		flipCamLookY: 0,
		flipCamHeightY: 0,
		smoothedLookAt: new THREE.Vector3(0, 0, 8),
		posVelocity: new THREE.Vector3(),
		framePan: new THREE.Vector3(),
		frameLookOffset: new THREE.Vector3(),
	};
}

/** Reset chase po golu / replay — płaski heading auta, bez flip-lock. */
export function resetChaseCameraHeading(
	state: ChaseCameraState,
	carQuat: THREE.Quaternion,
): void {
	state.initialized = false;
	state.shakeIntensity = 0;
	state.flipCamActive = false;
	state.flipCamLookY = 0;
	state.flipCamHeightY = 0;
	state.posVelocity.set(0, 0, 0);
	state.framePan.set(0, 0, 0);
	state.frameLookOffset.set(0, 0, 0);
	carHorizontalForwardFromQuat(carQuat, state.lastFlatForward);
	state.lastFlatForward.y = 0;
	if (state.lastFlatForward.lengthSq() > 1e-6) {
		state.lastFlatForward.normalize();
	} else {
		state.lastFlatForward.set(0, 0, 1);
	}
}

const _carForward = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _shakeOffset = new THREE.Vector3();
const _flatForward = new THREE.Vector3();
const _dirToCar = new THREE.Vector3();

export const BASE_FOV = RL_CAMERA.horizontalFov;
const MAX_HORIZONTAL_FOV = RL_CAMERA.horizontalFovBoost;

const _carLook = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _flatVel = new THREE.Vector3();
const _predictedCar = new THREE.Vector3();
const _framedLook = new THREE.Vector3();
const _frameTargetOff = new THREE.Vector3();

/** Aktywna kamera TPP — domyślnie Ball Cam (za autem, patrzy w stronę piłki). */
const PLAYER_TPP = {
	baseDistance: RL_CAMERA.distance,
	heightOffset: RL_CAMERA.height,
	/** Free / Car Cam — za autem wzdłuż osi przodu, patrzy do przodu auta. */
	carCamDistance: 5.8,
	carLookLift: RL_CAMERA.lookAtCarOffsetY,
	carLookAhead: 11,
	/** Ball Cam (domyślna) — za autem na linii XZ z piłką. */
	ballCamDistance: RL_CAMERA.distance,
	/** Spring pozycji — sekundy (niższe = szybsza reakcja). */
	posSmoothTimeBall: 0.1,
	posSmoothTimeCar: 0.085,
	posSmoothTimeAerial: 0.075,
	/** Wygładzenie lookAt (Hz). */
	lookSmoothHz: 14,
	/** Max prędkość kamery (m/s). */
	maxCameraSpeed: 95,
	snapDistSq: 12 * 12,
	/** Niższy blend = auto bliżej środka kadru (piłka mniej „ciągnie” look). */
	ballLookBlendMin: 0.16,
	ballLookBlendMax: 0.32,
	aerialHeightFollow: 0.28,
	maxAerialHeightLift: 5.5,
	/** Extra lift lookAt przy prędkości — horyzont nie tonie. */
	speedHorizonLift: 0.28,
	/**
	 * Ball cam przy prędkości: ile % pozycji „za wektorem prędkości”
	 * (łagodnie — za twarde = jitter).
	 */
	velChaseBlendMax: 0.38,
	velChaseBlendBoost: 0.52,
	/** Predykcja pozycji auta (s). */
	predictSecMin: 0.02,
	predictSecMax: 0.07,
	predictBoostMul: 1.2,
} as const;

/** Unity-style smoothDamp — stabilny chase niezależny od FPS. */
export function smoothDampScalar(
	current: number,
	target: number,
	velocity: { value: number },
	smoothTime: number,
	dt: number,
	maxSpeed = Number.POSITIVE_INFINITY,
): number {
	const st = Math.max(0.0001, smoothTime);
	const omega = 2 / st;
	const x = omega * dt;
	const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
	let change = current - target;
	const originalTo = target;

	const maxChange = maxSpeed * st;
	if (maxChange < Number.POSITIVE_INFINITY) {
		change = Math.sign(change) * Math.min(Math.abs(change), maxChange);
	}

	const tempTarget = current - change;
	const temp = (velocity.value + omega * change) * dt;
	velocity.value = (velocity.value - omega * temp) * exp;
	let output = tempTarget + (change + temp) * exp;

	if (originalTo - current > 0 === output > originalTo) {
		output = originalTo;
		velocity.value = (output - originalTo) / Math.max(dt, 1e-6);
	}
	return output;
}

function smoothDampVec3(
	current: THREE.Vector3,
	target: THREE.Vector3,
	velocity: THREE.Vector3,
	smoothTime: number,
	dt: number,
	maxSpeed: number = PLAYER_TPP.maxCameraSpeed,
): void {
	const vx = { value: velocity.x };
	const vy = { value: velocity.y };
	const vz = { value: velocity.z };
	current.x = smoothDampScalar(
		current.x,
		target.x,
		vx,
		smoothTime,
		dt,
		maxSpeed,
	);
	current.y = smoothDampScalar(
		current.y,
		target.y,
		vy,
		smoothTime,
		dt,
		maxSpeed,
	);
	current.z = smoothDampScalar(
		current.z,
		target.z,
		vz,
		smoothTime,
		dt,
		maxSpeed,
	);
	velocity.set(vx.value, vy.value, vz.value);
}

function flatCarForward(
	carForward: THREE.Vector3,
	out: THREE.Vector3,
): THREE.Vector3 {
	out.set(carForward.x, 0, carForward.z);
	if (out.lengthSq() < 1e-6) {
		return out.set(0, 0, 1);
	}
	return out.normalize();
}

export function isCarInCameraFrustum(
	camera: THREE.PerspectiveCamera,
	carPos: THREE.Vector3,
	margin = CAM_NDC_MARGIN,
): boolean {
	_ndc.copy(carPos).project(camera);
	return (
		_ndc.z >= -1 &&
		_ndc.z <= 1 &&
		Math.abs(_ndc.x) <= 1 - margin &&
		Math.abs(_ndc.y) <= 1 - margin
	);
}

/** Ball Cam: za autem na linii piłka→auto. Free Cam: za autem wzdłuż −forward auta. */
export function computePlayerTppTarget(
	carPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	carForward: THREE.Vector3,
	distance: number = PLAYER_TPP.baseDistance,
	isBallCam = false,
	heightYOverride?: number,
): THREE.Vector3 {
	flatCarForward(carForward, _flatForward);

	if (isBallCam) {
		_dirToCar.subVectors(carPos, ballPos);
		// Meridian: pełny 3D (piłka na ścianie/suficie) — bez spłaszczania Y.
		if (!isMeridianArenaActive()) {
			_dirToCar.y = 0;
		}

		if (_dirToCar.lengthSq() < 0.25) {
			if (isMeridianArenaActive()) {
				_dirToCar.copy(carForward);
				if (_dirToCar.lengthSq() < 1e-6) _dirToCar.set(0, 0, 1);
				else _dirToCar.normalize();
			} else {
				_dirToCar.copy(_flatForward);
			}
		} else {
			_dirToCar.normalize();
		}

		if (isMeridianArenaActive()) {
			return computeMeridianCamTarget(
				carPos,
				ballPos,
				carForward,
				true,
				_targetPos,
			);
		}

		_targetPos.set(
			carPos.x + _dirToCar.x * distance,
			carPos.y + PLAYER_TPP.heightOffset,
			carPos.z + _dirToCar.z * distance,
		);

		const ballLift = ballPos.y - carPos.y;
		if (ballLift > 0.6) {
			const aerialT = THREE.MathUtils.clamp(ballLift / 18, 0, 1);
			_targetPos.y +=
				Math.min(
					ballLift * PLAYER_TPP.aerialHeightFollow,
					PLAYER_TPP.maxAerialHeightLift,
				) * aerialT;
		}

		return _targetPos;
	}

	if (isMeridianArenaActive()) {
		return computeMeridianCamTarget(
			carPos,
			ballPos,
			carForward,
			false,
			_targetPos,
		);
	}

	_targetPos.set(
		carPos.x - _flatForward.x * distance,
		heightYOverride ?? carPos.y + PLAYER_TPP.heightOffset,
		carPos.z - _flatForward.z * distance,
	);
	return _targetPos;
}

function computeTppLookAt(
	carPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	carForward: THREE.Vector3,
	isBallCam: boolean,
	lookYOverride?: number,
	maxBallBlend?: number,
): THREE.Vector3 {
	flatCarForward(carForward, _flatForward);

	if (!isBallCam) {
		if (isMeridianArenaActive()) {
			return computeMeridianCamLookAt(
				carPos,
				ballPos,
				carForward,
				false,
				_lookAt,
			);
		}
		return _lookAt.set(
			carPos.x + _flatForward.x * PLAYER_TPP.carLookAhead,
			lookYOverride ?? carPos.y + PLAYER_TPP.carLookLift,
			carPos.z + _flatForward.z * PLAYER_TPP.carLookAhead,
		);
	}

	if (isMeridianArenaActive()) {
		return computeMeridianCamLookAt(
			carPos,
			ballPos,
			carForward,
			true,
			_lookAt,
		);
	}

	_carLook.set(carPos.x, carPos.y + PLAYER_TPP.carLookLift, carPos.z);

	const hSep = Math.hypot(ballPos.x - carPos.x, ballPos.z - carPos.z);
	let blend = THREE.MathUtils.clamp(
		hSep / 22 + PLAYER_TPP.ballLookBlendMin,
		PLAYER_TPP.ballLookBlendMin,
		PLAYER_TPP.ballLookBlendMax,
	);

	const vSep = ballPos.y - carPos.y;
	if (vSep > 3.5) {
		blend *= THREE.MathUtils.clamp(1 - (vSep - 3.5) / 22, 0.48, 1);
	}
	if (maxBallBlend != null) {
		blend = Math.min(blend, maxBallBlend);
	}

	return _lookAt.lerpVectors(_carLook, ballPos, blend);
}

/** Speed lead — kamera wyprzedza auto przy boost / wysokiej prędkości. */
export function applySpeedLeadToTarget(
	targetPos: THREE.Vector3,
	carVelocity: THREE.Vector3,
	boosting: boolean,
): void {
	_flatVel.set(carVelocity.x, 0, carVelocity.z);
	const spd = _flatVel.length();
	if (spd < 0.4) return;
	_flatVel.multiplyScalar(1 / spd);
	const t = THREE.MathUtils.clamp(spd / RL_CAR.maxSpeed, 0, 1);
	const lead = THREE.MathUtils.lerp(
		PLAYER_FRAME.leadMin,
		PLAYER_FRAME.leadMax,
		t * t,
	);
	const mul = boosting ? PLAYER_FRAME.leadBoostMul : 1;
	targetPos.addScaledVector(_flatVel, lead * mul);
}

/**
 * Predykcja pozycji auta — chase wokół lekkiego look-ahead (bez pchania
 * targetu kamery wzdłuż prędkości, które wyprzedzało auto).
 */
export function predictCarPosForChase(
	carPos: THREE.Vector3,
	carVelocity: THREE.Vector3,
	boosting: boolean,
	out: THREE.Vector3,
): THREE.Vector3 {
	_flatVel.set(carVelocity.x, 0, carVelocity.z);
	const spd = _flatVel.length();
	out.copy(carPos);
	if (spd < 0.5) return out;
	const speedT = THREE.MathUtils.clamp(spd / RL_CAR.maxSpeed, 0, 1);
	const leadSec =
		THREE.MathUtils.lerp(
			PLAYER_TPP.predictSecMin,
			PLAYER_TPP.predictSecMax,
			speedT * speedT,
		) * (boosting ? PLAYER_TPP.predictBoostMul : 1);
	out.addScaledVector(_flatVel, leadSec);
	return out;
}

/**
 * Ball cam: łagodny blend pozycji „za wektorem jazdy” przy prędkości.
 * Za mocny blend + snapy = jitter; tu tylko miękkie dociągnięcie targetu.
 */
export function applyVelocityChaseBlend(
	targetPos: THREE.Vector3,
	carPos: THREE.Vector3,
	carVelocity: THREE.Vector3,
	distance: number,
	heightY: number,
	boosting: boolean,
): void {
	_flatVel.set(carVelocity.x, 0, carVelocity.z);
	const spd = _flatVel.length();
	if (spd < 3) return;
	_flatVel.multiplyScalar(1 / spd);
	const speedT = THREE.MathUtils.clamp(spd / RL_CAR.maxSpeed, 0, 1);
	const maxBlend = boosting
		? PLAYER_TPP.velChaseBlendBoost
		: PLAYER_TPP.velChaseBlendMax;
	const blend = THREE.MathUtils.smoothstep(speedT, 0.35, 1) * maxBlend;
	if (blend < 0.02) return;
	_dirToCar.set(
		carPos.x - _flatVel.x * distance,
		heightY,
		carPos.z - _flatVel.z * distance,
	);
	targetPos.lerp(_dirToCar, blend);
}

/**
 * Screen-space framing — miękkie centrowanie auta w PLAYER_FRAME.
 * Offset jest trwały (frameLookOffset), żeby nie przegrywał z lookAt lerp.
 * Bez snapów pozycji / edge-catch.
 */
export function applyPlayerScreenFraming(
	camera: THREE.PerspectiveCamera,
	carPos: THREE.Vector3,
	state: ChaseCameraState,
	dt: number,
	speedXZ: number,
): void {
	camera.updateMatrixWorld(true);
	_framedLook.copy(state.smoothedLookAt).add(state.frameLookOffset);
	camera.up.set(0, 1, 0);
	camera.lookAt(_framedLook);

	_ndc.copy(carPos).project(camera);
	if (_ndc.z < -0.35 || _ndc.z > 1.15) {
		/** Poza sensownym depth — wygaszaj offset, nie szarp. */
		const fade = Math.exp(-6 * dt);
		state.frameLookOffset.multiplyScalar(fade);
		state.framePan.multiplyScalar(fade);
		camera.lookAt(
			_framedLook.copy(state.smoothedLookAt).add(state.frameLookOffset),
		);
		return;
	}

	const preferY = PLAYER_FRAME.preferY;
	/** Błąd względem preferowanego środka. */
	let errX = _ndc.x;
	let errY = _ndc.y - preferY;

	/** Soft zone: wewnątrz bezpiecznej ramki tylko lekkie dociągnięcie. */
	const soft = PLAYER_FRAME.softCenterPull;
	const absX = Math.abs(_ndc.x);
	if (absX <= PLAYER_FRAME.maxAbsX * 0.45) {
		errX *= soft * 0.45;
	} else if (absX <= PLAYER_FRAME.maxAbsX) {
		errX *= soft;
	}
	if (_ndc.y >= PLAYER_FRAME.minY && _ndc.y <= PLAYER_FRAME.maxY) {
		errY *= soft * 0.55;
	}

	const decay = 1 - Math.exp(-10 * dt);
	state.framePan.x = THREE.MathUtils.lerp(state.framePan.x, errX, decay);
	state.framePan.y = THREE.MathUtils.lerp(state.framePan.y, errY, decay);

	const speedT = THREE.MathUtils.clamp(speedXZ / RL_CAR.maxSpeed, 0, 1);
	/** X zostaje silne przy prędkości — auto nie ucieka bokiem / do przodu w NDC. */
	const gainX = PLAYER_FRAME.panGainX * (1 + speedT * 0.45) * dt;
	const gainY =
		PLAYER_FRAME.panGainY *
		THREE.MathUtils.lerp(1, PLAYER_FRAME.panGainYAtSpeed, speedT * speedT) *
		dt;

	camera.getWorldDirection(_camDir);
	_camRight.set(_camDir.z, 0, -_camDir.x);
	if (_camRight.lengthSq() > 1e-6) {
		_camRight.normalize();
	} else {
		_camRight.set(1, 0, 0);
	}

	_frameTargetOff.copy(state.frameLookOffset);
	_frameTargetOff.addScaledVector(_camRight, -state.framePan.x * gainX);
	if (state.framePan.y < 0) {
		const pitchDownAllow = THREE.MathUtils.lerp(1, 0.25, speedT * speedT);
		_frameTargetOff.y += state.framePan.y * gainY * 1.35 * pitchDownAllow;
	} else {
		_frameTargetOff.y += state.framePan.y * gainY;
	}

	/** Bezpieczny clamp — bez uciekania lookAt w nieskończoność. */
	const maxOff = PLAYER_FRAME.maxLookOffsetM;
	if (_frameTargetOff.lengthSq() > maxOff * maxOff) {
		_frameTargetOff.setLength(maxOff);
	}

	const offSmooth = 1 - Math.exp(-12 * dt);
	state.frameLookOffset.lerp(_frameTargetOff, offSmooth);

	_framedLook.copy(state.smoothedLookAt).add(state.frameLookOffset);
	clampLookAtPitch(camera.position, _framedLook);
	/** Zachowaj spójność: jeśli clamp uciął Y, wciągnij to w offset. */
	state.frameLookOffset.y = _framedLook.y - state.smoothedLookAt.y;

	camera.up.set(0, 1, 0);
	camera.lookAt(_framedLook);
}

/** Nie pozwalaj lookAt zejść poniżej maxPitchDown względem kamery. */
export function clampLookAtPitch(
	camPos: THREE.Vector3,
	lookAt: THREE.Vector3,
): void {
	// Meridian: piłka bywa nad kamerą — nie tnij pitch w górę.
	if (isMeridianArenaActive()) return;

	const dx = lookAt.x - camPos.x;
	const dz = lookAt.z - camPos.z;
	const horiz = Math.hypot(dx, dz);
	if (horiz < 0.15) return;
	const minLookY =
		camPos.y +
		horiz * Math.tan(THREE.MathUtils.degToRad(PLAYER_FRAME.maxPitchDownDeg));
	if (lookAt.y < minLookY) {
		lookAt.y = minLookY;
	}
}

/**
 * Soft bias do RL_CAMERA.angleDeg — bez tego ball-look na dalszą piłkę
 * trzyma pitch ~−3…−4° (za dużo nieba / „rybie oko”).
 * Nie walczy z aerial; przy prędkości słabnie (speedHorizonLift zostaje).
 */
export function applyChaseAngleBias(
	camPos: THREE.Vector3,
	lookAt: THREE.Vector3,
	ballPos: THREE.Vector3,
	carPos: THREE.Vector3,
	speedT = 0,
): void {
	if (isMeridianArenaActive()) return;
	if (ballPos.y - carPos.y > 4) return;

	const dx = lookAt.x - camPos.x;
	const dz = lookAt.z - camPos.z;
	const horiz = Math.hypot(dx, dz);
	if (horiz < 0.2) return;

	const desiredY =
		camPos.y + horiz * Math.tan(THREE.MathUtils.degToRad(CAMERA_ANGLE));
	if (lookAt.y <= desiredY) return;

	const strength = THREE.MathUtils.lerp(0.72, 0.28, speedT * speedT);
	lookAt.y = THREE.MathUtils.lerp(lookAt.y, desiredY, strength);
}

/**
 * Ostateczny update aktywnej kamery gracza (TPP Ball-line).
 * Jeden spring pozycji + wygładzony lookAt — bez snapów / edge-catch.
 */
export function updatePlayerTppCamera(
	camera: THREE.PerspectiveCamera,
	carPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	carQuat: THREE.Quaternion,
	dt: number,
	state: ChaseCameraState,
	isBallCam: boolean,
	isFlipping = false,
	carVelocity = _flatVel.set(0, 0, 0),
	boosting = false,
): void {
	if (
		!Number.isFinite(carPos.x) ||
		!Number.isFinite(carPos.y) ||
		!Number.isFinite(carPos.z) ||
		!Number.isFinite(ballPos.x) ||
		!Number.isFinite(ballPos.y) ||
		!Number.isFinite(ballPos.z)
	) {
		return;
	}

	_carForward.set(0, 0, 1).applyQuaternion(carQuat);
	if (!isBallCam) {
		carHorizontalForwardFromQuat(carQuat, _flatForward);
		if (!isFlipping) {
			state.lastFlatForward.copy(_flatForward);
		}
	} else if (isMeridianArenaActive()) {
		_flatForward.copy(_carForward);
		if (_flatForward.lengthSq() > 1e-6) {
			_flatForward.normalize();
			if (!isFlipping) {
				state.lastFlatForward.copy(_flatForward);
			}
		}
	} else {
		_flatForward.set(_carForward.x, 0, _carForward.z);
		if (_flatForward.lengthSq() > 1e-6) {
			_flatForward.normalize();
			if (!isFlipping) {
				state.lastFlatForward.copy(_flatForward);
			}
		}
	}

	if (isFlipping && !isBallCam) {
		if (!state.flipCamActive) {
			state.flipCamActive = true;
			state.flipCamLookY = carPos.y + PLAYER_TPP.carLookLift;
			state.flipCamHeightY = carPos.y + PLAYER_TPP.heightOffset;
		}
	} else if (state.flipCamActive) {
		state.flipCamActive = false;
	}

	const distance = isBallCam
		? PLAYER_TPP.ballCamDistance
		: PLAYER_TPP.carCamDistance;

	const heightOverride =
		state.flipCamActive && !isBallCam ? state.flipCamHeightY : undefined;
	const lookYOverride =
		state.flipCamActive && !isBallCam ? state.flipCamLookY : undefined;

	computePlayerTppTarget(
		predictCarPosForChase(carPos, carVelocity, boosting, _predictedCar),
		ballPos,
		state.lastFlatForward,
		distance,
		isBallCam,
		heightOverride,
	);
	if (isBallCam && !isMeridianArenaActive()) {
		applyVelocityChaseBlend(
			_targetPos,
			_predictedCar,
			carVelocity,
			distance,
			_targetPos.y,
			boosting,
		);
	}

	if (!state.initialized) {
		camera.position.copy(_targetPos);
		computeTppLookAt(
			carPos,
			ballPos,
			state.lastFlatForward,
			isBallCam,
			lookYOverride,
		);
		applyChaseAngleBias(camera.position, _lookAt, ballPos, carPos, 0);
		clampLookAtPitch(camera.position, _lookAt);
		state.smoothedLookAt.copy(_lookAt);
		state.posVelocity.set(0, 0, 0);
		state.initialized = true;
	}

	const verticalSep = Math.abs(ballPos.y - carPos.y);
	const speedXZ = Math.hypot(carVelocity.x, carVelocity.z);
	const speedT = THREE.MathUtils.clamp(speedXZ / RL_CAR.maxSpeed, 0, 1);
	let smoothTime = isBallCam
		? verticalSep > 2.5
			? PLAYER_TPP.posSmoothTimeAerial
			: PLAYER_TPP.posSmoothTimeBall
		: PLAYER_TPP.posSmoothTimeCar;
	/** Przy prędkości / boost — trochę ostrzejszy spring, bez snapów. */
	smoothTime *= THREE.MathUtils.lerp(1, 0.55, speedT * speedT);
	if (boosting) smoothTime *= 0.72;
	const maxCamSpeed =
		PLAYER_TPP.maxCameraSpeed *
		THREE.MathUtils.lerp(1, 1.55, speedT) *
		(boosting ? 1.15 : 1);

	if (camera.position.distanceToSquared(_targetPos) > PLAYER_TPP.snapDistSq) {
		camera.position.copy(_targetPos);
		state.posVelocity.set(0, 0, 0);
	} else {
		smoothDampVec3(
			camera.position,
			_targetPos,
			state.posVelocity,
			smoothTime,
			dt,
			maxCamSpeed,
		);
	}

	let maxBallBlend: number | undefined;
	if (isBallCam && speedT > 0.35) {
		maxBallBlend = THREE.MathUtils.lerp(
			PLAYER_TPP.ballLookBlendMax,
			PLAYER_TPP.ballLookBlendMin,
			(speedT - 0.35) / 0.65,
		);
		if (boosting) {
			maxBallBlend = Math.min(maxBallBlend, PLAYER_TPP.ballLookBlendMin + 0.04);
		}
	}

	computeTppLookAt(
		carPos,
		ballPos,
		state.lastFlatForward,
		isBallCam,
		lookYOverride,
		maxBallBlend,
	);
	if (!isMeridianArenaActive()) {
		_lookAt.y += speedT * PLAYER_TPP.speedHorizonLift;
	}
	applyChaseAngleBias(camera.position, _lookAt, ballPos, carPos, speedT);
	clampLookAtPitch(camera.position, _lookAt);
	const lookAlpha = 1 - Math.exp(-PLAYER_TPP.lookSmoothHz * dt);
	state.smoothedLookAt.lerp(_lookAt, lookAlpha);
	clampLookAtPitch(camera.position, state.smoothedLookAt);

	if (isMeridianArenaActive()) {
		clampPointInsideMeridian(camera.position, 3.2);
		meridianCameraUp(carPos, _camDir);
		camera.up.copy(_camDir);
	} else {
		camera.up.set(0, 1, 0);
	}
	camera.lookAt(state.smoothedLookAt);
}

/** @deprecated alias — używaj updatePlayerTppCamera */
export function updateBallCam(
	camera: THREE.PerspectiveCamera,
	carPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	dt: number,
	state: ChaseCameraState,
): void {
	updatePlayerTppCamera(
		camera,
		carPos,
		ballPos,
		new THREE.Quaternion(0, 0, 0, 1),
		dt,
		state,
		true,
	);
}

export function sampleChaseCameraTargets(
	carPos: THREE.Vector3,
	orbitForward: THREE.Vector3,
	ballPos: THREE.Vector3,
	isBallCam: boolean,
): { targetPos: THREE.Vector3; lookAt: THREE.Vector3 } {
	const distance = isBallCam
		? PLAYER_TPP.ballCamDistance
		: PLAYER_TPP.carCamDistance;
	const targetPos = computePlayerTppTarget(
		carPos,
		ballPos,
		orbitForward,
		distance,
		isBallCam,
	);
	const lookAt = computeTppLookAt(carPos, ballPos, orbitForward, isBallCam);
	applyChaseAngleBias(targetPos, lookAt, ballPos, carPos, 0);
	clampLookAtPitch(targetPos, lookAt);
	return { targetPos, lookAt };
}

export function updateChaseCamera(
	camera: THREE.PerspectiveCamera,
	carPos: THREE.Vector3,
	carQuat: THREE.Quaternion,
	ballPos: THREE.Vector3,
	isBallCam: boolean,
	dt: number,
	boosting: boolean,
	speed: number,
	state: ChaseCameraState,
	baseHorizontalFov = BASE_FOV,
	speedXZ = 0,
	_wheelsGrounded = 0,
	goalFovBoost = 0,
	isFlipping = false,
	carVelocity = _flatVel.set(0, 0, 0),
): void {
	updatePlayerTppCamera(
		camera,
		carPos,
		ballPos,
		carQuat,
		dt,
		state,
		isBallCam,
		isFlipping,
		carVelocity,
		boosting,
	);

	/** Meridian: framing world-up psuje kadr na ścianie/suficie. */
	if (!isMeridianArenaActive()) {
		applyPlayerScreenFraming(camera, carPos, state, dt, speedXZ);
	}

	if (state.shakeIntensity > 0.001) {
		state.shakeIntensity *= 0.04 ** dt;
		const s = state.shakeIntensity;
		_shakeOffset.set(
			(Math.random() - 0.5) * s * 0.1,
			(Math.random() - 0.5) * s * 0.06,
			(Math.random() - 0.5) * s * 0.1,
		);
		camera.position.add(_shakeOffset);
	} else {
		state.shakeIntensity = 0;
	}

	const speedT = THREE.MathUtils.clamp(speed / RL_CAR.maxSpeed, 0, 1);
	const boostT = boosting ? 0.35 : 0;
	camera.updateMatrixWorld(true);
	_ndc.copy(carPos).project(camera);
	const lowInFrame = _ndc.y < PLAYER_FRAME.minY + 0.06;
	const fovSpeedT = lowInFrame ? speedT * 0.35 : speedT;
	const meridianFov = isMeridianArenaActive() ? MERIDIAN_CAM.fovBoost : 0;
	const targetHFov =
		THREE.MathUtils.lerp(
			baseHorizontalFov,
			MAX_HORIZONTAL_FOV,
			Math.max(fovSpeedT * 0.22, boostT * (lowInFrame ? 0.15 : 1)),
		) +
		goalFovBoost +
		meridianFov;
	const fovLerp = 1 - 0.001 ** (dt * 60);
	state.currentHorizontalFov = THREE.MathUtils.lerp(
		state.currentHorizontalFov,
		targetHFov,
		fovLerp,
	);
	const verticalFov = horizontalFovToVertical(
		state.currentHorizontalFov,
		camera.aspect,
	);
	if (Math.abs(camera.fov - verticalFov) > 0.02) {
		camera.fov = verticalFov;
		camera.updateProjectionMatrix();
	}
}
