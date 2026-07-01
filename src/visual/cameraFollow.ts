import * as THREE from "three";

import { RL_CAMERA, RL_CAR } from "../util/rlConstants";
import { carHorizontalForwardFromQuat } from "../util/rlPhysics";

export const CAMERA_DISTANCE = RL_CAMERA.distance;
export const CAMERA_HEIGHT = RL_CAMERA.height;
export const CAMERA_ANGLE = RL_CAMERA.angleDeg;
export const CAMERA_STIFFNESS = RL_CAMERA.stiffness;

export const CAM_MAX_DIST_XZ = 12;
export const CAM_MAX_DIST_3D = 15;
export const CAM_NDC_MARGIN = 0.12;

/** @deprecated Użyj CAMERA_STIFFNESS — zachowane dla diagnostyki. */
export const CAM_POS_LERP = CAMERA_STIFFNESS;

export type ChaseCameraState = {
	initialized: boolean;
	currentHorizontalFov: number;
	shakeIntensity: number;
	lastFlatForward: THREE.Vector3;
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
	};
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

/** Aktywna kamera TPP — domyślnie Ball Cam (za autem, patrzy w stronę piłki). */
const PLAYER_TPP = {
	baseDistance: RL_CAMERA.distance,
	heightOffset: RL_CAMERA.height,
	cameraSpeed: 8.0,
	/** Free / Car Cam — za autem wzdłuż osi przodu, patrzy do przodu auta. */
	carCamDistance: 5.8,
	carCamSpeed: 8.5,
	carLookLift: RL_CAMERA.lookAtCarOffsetY,
	carLookAhead: 11,
	snapDistSq: 14 * 14,
	/** Ball Cam (domyślna) — za autem na linii XZ z piłką. */
	ballCamDistance: RL_CAMERA.distance,
	ballCamSpeed: 9.5,
	/** Niższy blend = mniej patrzenia w piłkę, auto wyżej w kadrze. */
	ballLookBlendMin: 0.22,
	ballLookBlendMax: 0.48,
	aerialHeightFollow: 0.28,
	maxAerialHeightLift: 5.5,
} as const;

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
): THREE.Vector3 {
	flatCarForward(carForward, _flatForward);

	if (!isBallCam) {
		_targetPos.set(
			carPos.x - _flatForward.x * distance,
			carPos.y + PLAYER_TPP.heightOffset,
			carPos.z - _flatForward.z * distance,
		);
		return _targetPos;
	}

	_dirToCar.subVectors(carPos, ballPos);
	_dirToCar.y = 0;

	if (_dirToCar.lengthSq() < 0.04) {
		_dirToCar.copy(_flatForward);
	} else {
		_dirToCar.normalize();
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

function computeTppLookAt(
	carPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	carForward: THREE.Vector3,
	isBallCam: boolean,
): THREE.Vector3 {
	flatCarForward(carForward, _flatForward);

	if (!isBallCam) {
		return _lookAt.set(
			carPos.x + _flatForward.x * PLAYER_TPP.carLookAhead,
			carPos.y + PLAYER_TPP.carLookLift,
			carPos.z + _flatForward.z * PLAYER_TPP.carLookAhead,
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

	return _lookAt.lerpVectors(_carLook, ballPos, blend);
}

/**
 * Ostateczny update aktywnej kamery gracza (TPP Ball-line).
 * Zawsze za autem na linii z piłką — płynny lerp, bez widoku scenicznego.
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
	} else {
		_flatForward.set(_carForward.x, 0, _carForward.z);
		if (_flatForward.lengthSq() > 1e-6) {
			_flatForward.normalize();
			state.lastFlatForward.copy(_flatForward);
		}
	}

	const distance = isBallCam
		? PLAYER_TPP.ballCamDistance
		: PLAYER_TPP.carCamDistance;
	const baseSpeed = isBallCam
		? PLAYER_TPP.ballCamSpeed
		: PLAYER_TPP.carCamSpeed;

	computePlayerTppTarget(
		carPos,
		ballPos,
		state.lastFlatForward,
		distance,
		isBallCam,
	);

	if (!state.initialized) {
		camera.position.copy(_targetPos);
		state.initialized = true;
	}

	const ballSep = Math.sqrt(carPos.distanceToSquared(ballPos));
	const verticalSep = Math.abs(ballPos.y - carPos.y);
	const aerialBoost = isBallCam
		? THREE.MathUtils.clamp(verticalSep / 10, 0, 1.4)
		: 0;
	const speedBoost =
		1 + THREE.MathUtils.clamp(ballSep / 20, 0, 1.8) + aerialBoost;
	const posAlpha = Math.min(1, baseSpeed * speedBoost * dt);

	if (camera.position.distanceToSquared(_targetPos) > PLAYER_TPP.snapDistSq) {
		camera.position.copy(_targetPos);
	} else if (isBallCam && verticalSep > 2.5) {
		camera.position.x = THREE.MathUtils.lerp(
			camera.position.x,
			_targetPos.x,
			posAlpha,
		);
		camera.position.z = THREE.MathUtils.lerp(
			camera.position.z,
			_targetPos.z,
			posAlpha,
		);
		const yAlpha = Math.min(1, posAlpha * (1.15 + aerialBoost * 0.35));
		camera.position.y = THREE.MathUtils.lerp(
			camera.position.y,
			_targetPos.y,
			yAlpha,
		);
	} else {
		camera.position.lerp(_targetPos, posAlpha);
	}

	computeTppLookAt(carPos, ballPos, state.lastFlatForward, isBallCam);
	camera.up.set(0, 1, 0);
	camera.lookAt(_lookAt);
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
	_speedXZ = 0,
	_wheelsGrounded = 0,
	goalFovBoost = 0,
	isFlipping = false,
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
	);

	if (state.shakeIntensity > 0.001) {
		state.shakeIntensity *= 0.06 ** dt;
		const s = state.shakeIntensity;
		_shakeOffset.set(
			(Math.random() - 0.5) * s * 0.22,
			(Math.random() - 0.5) * s * 0.14,
			(Math.random() - 0.5) * s * 0.22,
		);
		camera.position.add(_shakeOffset);
	} else {
		state.shakeIntensity = 0;
	}

	const speedT = THREE.MathUtils.clamp(speed / RL_CAR.maxSpeed, 0, 1);
	const boostT = boosting ? 0.35 : 0;
	const targetHFov =
		THREE.MathUtils.lerp(
			baseHorizontalFov,
			MAX_HORIZONTAL_FOV,
			Math.max(speedT * 0.25, boostT),
		) + goalFovBoost;
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
