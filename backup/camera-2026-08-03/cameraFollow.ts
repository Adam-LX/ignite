import * as THREE from "three";

import { RL_CAMERA, RL_CAR } from "../util/rlConstants";
import { carHorizontalForwardFromQuat } from "../util/rlPhysics";
import {
	PLAYFIELD_SURFACE_Y,
	RL_ARENA,
} from "./arenaConstants";
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
/**
 * Kickoff — lekko dalej niż chase (czytelny kickoff), nadal blisko RL.
 */
export const KICKOFF_CAM_DISTANCE = 3.55;
export const KICKOFF_CAM_HEIGHT = 1.45;
export const KICKOFF_LOOK_Y = 0.42;
export const KICKOFF_LOOK_AHEAD = 0.4;

export const CAM_MAX_DIST_XZ = 9;
export const CAM_MAX_DIST_3D = 11;
export const CAM_NDC_MARGIN = 0.12;

/** Bezpieczna strefa auta w NDC — mocniejsze dociąganie przy ucieczce z kadru. */
export const PLAYER_FRAME = {
	/**
	 * Preferowany NDC Y. Three.js: +1 góra, −1 dół.
	 * RL-like: auto w dolnej trzeciej — nie za nisko (trawa + fisheye).
	 */
	preferY: -0.14,
	minY: -0.5,
	maxY: 0.12,
	maxAbsX: 0.12,
	/** Siła korekty lookAt w poziomie (world units per NDC error). */
	panGainX: 32,
	/** Pionowa korekta — umiarkowana, framing nie szarpie pitch. */
	panGainY: 7,
	/** Przy max speed: ile % pionowej korekty zostaje (0–1). */
	panGainYAtSpeed: 0.75,
	/** Miękkie dociągnięcie tylko blisko prefer (0–1). */
	softCenterPull: 0.28,
	/** Max trwały offset lookAt (m) — musi wystarczyć na skorygowanie boku. */
	maxLookOffsetM: 3.2,
	/** Wyprzedzenie kamery w kierunku jazdy (m) — tylko dla applySpeedLeadToTarget. */
	leadMin: 0.25,
	leadMax: 1.0,
	leadBoostMul: 1.12,
	/**
	 * Max pitch w dół — framing może lekko patrzeć w auto, bez top-down.
	 */
	/**
	 * Max pitch w dół — kickoff/TPP musi móc patrzeć na auto (~−12…−16°).
	 * −8° przy dystansie 5 m trzymało lookAt za wysoko → ndc.y≈−0.8 (auto
	 * pod kadrem, pusta murawa na środku — wygląda jak orbita menu).
	 */
	maxPitchDownDeg: -16,
	/** Min. dystans XZ kamera↔auto — RL ~2.7 m; niżej = top-down. */
	minCamDistXZ: 2.35,
	/** Poza tą strefą NDC — pełna siła edge recovery (nie soft). */
	edgeHardX: 0.62,
	edgeHardY: 0.7,
	/** Przy boost: nieco wyżej, bez ucięcia. */
	preferYBoosting: -0.2,
	/**
	 * Floor-guard: tylko gdy auto naprawdę tonie — inaczej walczy ze springiem.
	 */
	floorGuardY: -0.52,
} as const;

/** @deprecated Użyj CAMERA_STIFFNESS — zachowane dla diagnostyki. */
export const CAM_POS_LERP = CAMERA_STIFFNESS;

export type ChaseCameraState = {
	initialized: boolean;
	currentHorizontalFov: number;
	shakeIntensity: number;
	/**
	 * Offset shake z poprzedniej klatki — odejmowany PRZED springiem,
	 * inaczej losowy jitter wchodzi w damp i „rozdwaja” kadr.
	 */
	shakeApplied: THREE.Vector3;
	lastFlatForward: THREE.Vector3;
	/** Free / air: zamrożony kadr (RL — kamera nie przechyla się z nosem auta). */
	flipCamActive: boolean;
	flipCamLookY: number;
	flipCamHeightY: number;
	/** FOV na starcie flipa — impuls dodge nie zmienia projekcji. */
	flipCamFov: number;
	/**
	 * Powietrze (skok + W/S pitch): zamrożony heading + stały pitch look.
	 * Bez tego spring / ball-look / FOV zmieniają kąt patrzenia przy pitchu nosa.
	 */
	airCamActive: boolean;
	airCamForward: THREE.Vector3;
	/** Zamrożony pitch look (rad) z chwili odklejenia — atan2(dir.y, horiz). */
	airCamPitchRad: number;
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

/**
 * Ultrawide: trzymaj vFOV jak @ 16:9 — inaczej auto tonie (YOU na trawie).
 * Liczone dokładnie z vFOV ref, nie liniowym +26° (to dawało fisheye ~127° hFOV
 * na 3440×1440 / Medal 1720×720 — feedback Kamila).
 */
export function horizontalFovForAspect(
	baseHorizontalDeg: number,
	aspect: number,
): number {
	const refAspect = 16 / 9;
	if (aspect <= refAspect + 0.02) return baseHorizontalDeg;
	const vFov = horizontalFovToVertical(baseHorizontalDeg, refAspect);
	const vRad = THREE.MathUtils.degToRad(vFov);
	const hRad = 2 * Math.atan(Math.tan(vRad * 0.5) * aspect);
	return THREE.MathUtils.radToDeg(hRad);
}

export function createChaseCameraState(
	baseHorizontalFov: number = RL_CAMERA.horizontalFov,
): ChaseCameraState {
	return {
		initialized: false,
		currentHorizontalFov: baseHorizontalFov,
		shakeIntensity: 0,
		shakeApplied: new THREE.Vector3(),
		lastFlatForward: new THREE.Vector3(0, 0, 1),
		flipCamActive: false,
		flipCamLookY: 0,
		flipCamHeightY: 0,
		flipCamFov: baseHorizontalFov,
		airCamActive: false,
		airCamForward: new THREE.Vector3(0, 0, 1),
		airCamPitchRad: THREE.MathUtils.degToRad(CAMERA_ANGLE),
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
	state.shakeApplied.set(0, 0, 0);
	state.flipCamActive = false;
	state.flipCamLookY = 0;
	state.flipCamHeightY = 0;
	state.flipCamFov = 0;
	state.airCamActive = false;
	state.airCamForward.set(0, 0, 1);
	state.airCamPitchRad = THREE.MathUtils.degToRad(CAMERA_ANGLE);
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
const _flatForward = new THREE.Vector3();
const _dirToCar = new THREE.Vector3();
const _clampDir = new THREE.Vector3();
const _clampInward = new THREE.Vector3();

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
	/**
	 * Free / Car Cam — ten sam dystans co Ball Cam (RL parity).
	 * 7.4 m oddalało auto do „myszy” na ultrawide (klip Kamila).
	 */
	carCamDistance: RL_CAMERA.distance,
	carLookLift: 0.7,
	/**
	 * Look ahead free cam (m). Krótki — mniej „lufa w murawę”.
	 */
	carLookAhead: 2.4,
	carLookAheadMin: 1.5,
	/** Ball Cam (domyślna) — za autem (−forward), lekki look ku piłce. */
	ballCamDistance: RL_CAMERA.distance,
	/**
	 * Kickoff: szerszy kadr niż stary close-up — otoczenie + skybox.
	 */
	kickoffDistance: KICKOFF_CAM_DISTANCE,
	kickoffHeight: KICKOFF_CAM_HEIGHT,
	kickoffLookY: KICKOFF_LOOK_Y,
	/** Jak daleko przed autem patrzy kickoff snap (m wzdłuż forward). */
	kickoffLookAhead: KICKOFF_LOOK_AHEAD,
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
	ballLookBlendMin: 0.01,
	ballLookBlendMax: 0.035,
	aerialHeightFollow: 0.28,
	maxAerialHeightLift: 5.5,
	/** Extra lift lookAt przy prędkości — tylko free cam / lekki ball. */
	speedHorizonLift: 0.08,
	/**
	 * Ball cam: lift lookAt — za wysoko = auto tonie + pusta trawa;
	 * za nisko = tag na trawie.
	 */
	ballCamHorizonLift: 0.32,
	/**
	 * Free cam: lift lookAt (niższy = mniej patrzenia w niebo / stretch trawy).
	 */
	carCamHorizonLift: 0.26,
	/**
	 * Ball cam przy prędkości: ile % pozycji „za wektorem prędkości”.
	 * Niski blend — przy skręcie mocny vel-chase zbliżał kamerę (akord) = wrażenie podniesienia.
	 */
	velChaseBlendMax: 0.18,
	velChaseBlendBoost: 0.28,
	/** Vel-chase tylko gdy velocity ≈ kierunek ucieczki od piłki (dot). */
	velChaseAlignMin: 0.55,
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
		flatCarForward(carForward, _flatForward);
		_dirToCar.subVectors(carPos, ballPos);
		if (!isMeridianArenaActive()) {
			_dirToCar.y = 0;
		}

		if (_dirToCar.lengthSq() < 0.25) {
			/** Blisko piłki: za autem (−forward), nie przed. */
			_dirToCar.copy(_flatForward).multiplyScalar(-1);
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

		/**
		 * Ball-cam: CZYSTO −forward. Nawet 6% ball-line + clamp ściany
		 * = kamera obok auta; framing lookAt wtedy patrzy w trawę, auto na prawej
		 * (screen usera 3440×1440 @ 4:51).
		 */
		_dirToCar.copy(_flatForward).multiplyScalar(-1);

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

		clampCameraInsideSoccar(_targetPos, carPos);
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
	clampCameraInsideSoccar(_targetPos, carPos);
	return _targetPos;
}

function computeTppLookAt(
	carPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	carForward: THREE.Vector3,
	isBallCam: boolean,
	lookYOverride?: number,
	maxBallBlend?: number,
	_speedXZ = Number.POSITIVE_INFINITY,
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
		/** Stały look-ahead — bez zmiany kąta przy starcie z postoju. */
		const ahead = PLAYER_TPP.carLookAhead;
		return _lookAt.set(
			carPos.x + _flatForward.x * ahead,
			lookYOverride ?? carPos.y + PLAYER_TPP.carLookLift,
			carPos.z + _flatForward.z * ahead,
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

	_carLook.set(
		carPos.x + _flatForward.x * PLAYER_TPP.carLookAhead * 0.55,
		carPos.y + PLAYER_TPP.carLookLift,
		carPos.z + _flatForward.z * PLAYER_TPP.carLookAhead * 0.55,
	);

	/**
	 * Look PRZED autem. Zero yaw do piłki przy postoju / niskiej V —
	 * inaczej lookAt w środek boiska + kamera z boku = auto na prawej.
	 */
	const hSep = Math.hypot(ballPos.x - carPos.x, ballPos.z - carPos.z);
	let blend = THREE.MathUtils.clamp(
		hSep / 55 + PLAYER_TPP.ballLookBlendMin,
		PLAYER_TPP.ballLookBlendMin,
		PLAYER_TPP.ballLookBlendMax,
	);
	if (_speedXZ < 2.5) {
		blend *= 0.15;
	}

	const vSep = ballPos.y - carPos.y;
	if (vSep > 3.5) {
		blend *= THREE.MathUtils.clamp(1 - (vSep - 3.5) / 22, 0.48, 1);
	}
	if (maxBallBlend != null) {
		blend = Math.min(blend, maxBallBlend);
	}

	_dirToCar.set(ballPos.x - carPos.x, 0, ballPos.z - carPos.z);
	if (_dirToCar.lengthSq() > 1e-6) {
		_dirToCar.normalize();
		/** Punkt zainteresowania: przed autem, lekko przesunięty ku piłce. */
		_lookAt.set(
			_carLook.x + _dirToCar.x * (2.2 * blend * 18),
			THREE.MathUtils.lerp(
				_carLook.y,
				ballPos.y,
				blend * 0.65,
			),
			_carLook.z + _dirToCar.z * (2.2 * blend * 18),
		);
	} else {
		_lookAt.copy(_carLook);
	}
	return _lookAt;
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
	/** Predykcja dopiero przy realnej prędkości — start z W nie przesuwa targetu. */
	if (spd < 4.5) return out;
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
 * Tylko gdy jedziesz mniej-więcej od piłki — przy skręcie (velocity ⊥ ball-line)
 * lerp dwóch offsetów zbliża kamerę i wygląda jak podniesienie.
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
	if (spd < 4) return;
	_flatVel.multiplyScalar(1 / spd);

	/** Kierunek „za autem na linii piłki” = target − car (XZ). */
	_dirToCar.set(targetPos.x - carPos.x, 0, targetPos.z - carPos.z);
	if (_dirToCar.lengthSq() < 1e-6) return;
	_dirToCar.normalize();
	/** Velocity-behind = −vel; align z aktualnym ball-behind. */
	const align = -_flatVel.dot(_dirToCar);
	if (align < PLAYER_TPP.velChaseAlignMin) return;

	const speedT = THREE.MathUtils.clamp(spd / RL_CAR.maxSpeed, 0, 1);
	const maxBlend = boosting
		? PLAYER_TPP.velChaseBlendBoost
		: PLAYER_TPP.velChaseBlendMax;
	const alignT = THREE.MathUtils.smoothstep(
		align,
		PLAYER_TPP.velChaseAlignMin,
		0.95,
	);
	const blend =
		THREE.MathUtils.smoothstep(speedT, 0.4, 1) * maxBlend * alignT;
	if (blend < 0.02) return;
	_dirToCar.set(
		carPos.x - _flatVel.x * distance,
		heightY,
		carPos.z - _flatVel.z * distance,
	);
	targetPos.lerp(_dirToCar, blend);
}

/**
 * Gdy auto ucieka w X (kamera z boku / look w trawę): wsadź kamerę na −forward.
 * Sam lookAt-framing tego NIE naprawia — pogarsza (patrzy w pustą murawę).
 */
export function reaxisChaseCameraBehindCar(
	camera: THREE.PerspectiveCamera,
	carPos: THREE.Vector3,
	flatForward: THREE.Vector3,
	state: ChaseCameraState,
	lookAhead = PLAYER_TPP.carLookAhead * 0.55,
): void {
	flatCarForward(flatForward, _flatForward);
	if (_flatForward.lengthSq() < 1e-6) return;
	state.lastFlatForward.copy(_flatForward);

	const distXZ = Math.hypot(
		camera.position.x - carPos.x,
		camera.position.z - carPos.z,
	);
	const wantDist = THREE.MathUtils.clamp(
		distXZ || PLAYER_TPP.ballCamDistance,
		PLAYER_FRAME.minCamDistXZ,
		CAM_MAX_DIST_XZ,
	);
	const height = Math.max(
		carPos.y + PLAYER_TPP.heightOffset * 0.85,
		camera.position.y,
	);
	camera.position.set(
		carPos.x - _flatForward.x * wantDist,
		height,
		carPos.z - _flatForward.z * wantDist,
	);
	if (!isMeridianArenaActive()) {
		clampCameraInsideSoccar(camera.position, carPos);
		/** Po clampie — z powrotem na oś (ściana nie może zostawić „z boku”). */
		const dx = camera.position.x - carPos.x;
		const dz = camera.position.z - carPos.z;
		const along = dx * -_flatForward.x + dz * -_flatForward.z;
		if (along > 0.4) {
			const d = Math.min(along, wantDist);
			camera.position.x = carPos.x - _flatForward.x * d;
			camera.position.z = carPos.z - _flatForward.z * d;
		}
	}
	state.frameLookOffset.set(0, 0, 0);
	state.framePan.set(0, 0, 0);
	state.smoothedLookAt.set(
		carPos.x + _flatForward.x * lookAhead,
		carPos.y + PLAYER_TPP.carLookLift,
		carPos.z + _flatForward.z * lookAhead,
	);
	clampLookAtPitch(camera.position, state.smoothedLookAt);
	camera.up.set(0, 1, 0);
	camera.lookAt(state.smoothedLookAt);
}

/**
 * Screen-space framing — mocne trzymanie auta w PLAYER_FRAME.
 * Przy ucieczce poza soft zone / edgeHard — pełna siła (bez soft pull).
 */
export function applyPlayerScreenFraming(
	camera: THREE.PerspectiveCamera,
	carPos: THREE.Vector3,
	state: ChaseCameraState,
	dt: number,
	speedXZ: number,
	preferY: number = PLAYER_FRAME.preferY,
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

	let errX = _ndc.x;
	let errY = _ndc.y - preferY;

	const absX = Math.abs(_ndc.x);
	const absY = Math.abs(_ndc.y);
	const soft = PLAYER_FRAME.softCenterPull;
	const inSoftX = absX <= PLAYER_FRAME.maxAbsX;
	const inSoftY =
		_ndc.y >= PLAYER_FRAME.minY && _ndc.y <= PLAYER_FRAME.maxY;
	const hardEdge =
		absX >= PLAYER_FRAME.edgeHardX || absY >= PLAYER_FRAME.edgeHardY;

	if (hardEdge) {
		/** Auto prawie poza kadrem — pełny err, bez soft. */
	} else if (inSoftX && absX <= PLAYER_FRAME.maxAbsX * 0.5) {
		errX *= soft * 0.5;
	} else if (inSoftX) {
		errX *= soft;
	}
	/**
	 * Soft Y tylko gdy auto ZA WYSOKO (nad prefer).
	 * Gdy za nisko — pełny errY; inaczej soft×0.6 ≈ 0.21 trzyma ndcY
	 * przy minY i nigdy nie dogania preferY (−0.44 stuck).
	 */
	if (!hardEdge && inSoftY && errY > 0) {
		errY *= soft * 0.6;
	}

	const urgency = hardEdge
		? 2.15
		: 1 +
			THREE.MathUtils.clamp(
				(absX - PLAYER_FRAME.maxAbsX) / 0.35,
				0,
				1,
			) *
				0.75;

	const decay = 1 - Math.exp(-(hardEdge ? 16 : 12) * dt);
	state.framePan.x = THREE.MathUtils.lerp(state.framePan.x, errX, decay);
	state.framePan.y = THREE.MathUtils.lerp(state.framePan.y, errY, decay);

	const speedT = THREE.MathUtils.clamp(speedXZ / RL_CAR.maxSpeed, 0, 1);
	/** Gain niezależny od niskiej prędkości — bez szarpnięcia framingu przy starcie. */
	const speedGain =
		speedT < 0.2 ? 1 : 1 + THREE.MathUtils.smoothstep(speedT, 0.2, 1) * 0.35;
	const gainX = PLAYER_FRAME.panGainX * speedGain * urgency * dt;
	const gainY =
		PLAYER_FRAME.panGainY *
		THREE.MathUtils.lerp(1, PLAYER_FRAME.panGainYAtSpeed, speedT * speedT) *
		urgency *
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
	/**
	 * Pitch down (auto za nisko): ograniczone — pełny gain + maxPitch −14°
	 * wjeżdżało w top-down gdy distXZ malał.
	 */
	if (state.framePan.y < 0) {
		const pitchDownAllow = hardEdge
			? 0.85
			: THREE.MathUtils.lerp(0.55, 0.35, speedT * speedT);
		_frameTargetOff.y += state.framePan.y * gainY * pitchDownAllow;
	} else {
		_frameTargetOff.y += state.framePan.y * gainY;
	}

	const maxOff = hardEdge
		? PLAYER_FRAME.maxLookOffsetM * 1.25
		: PLAYER_FRAME.maxLookOffsetM;
	if (_frameTargetOff.lengthSq() > maxOff * maxOff) {
		_frameTargetOff.setLength(maxOff);
	}

	const offSmooth = 1 - Math.exp(-(hardEdge ? 18 : 14) * dt);
	state.frameLookOffset.lerp(_frameTargetOff, offSmooth);

	_framedLook.copy(state.smoothedLookAt).add(state.frameLookOffset);
	clampLookAtPitch(camera.position, _framedLook);
	state.frameLookOffset.y = _framedLook.y - state.smoothedLookAt.y;

	camera.up.set(0, 1, 0);
	camera.lookAt(_framedLook);
}

/** Nie pozwalaj lookAt zejść poniżej maxPitchDown względem kamery. */
export function clampLookAtPitch(
	camPos: THREE.Vector3,
	lookAt: THREE.Vector3,
	maxPitchDownDeg: number = PLAYER_FRAME.maxPitchDownDeg,
): void {
	// Meridian: piłka bywa nad kamerą — nie tnij pitch w górę.
	if (isMeridianArenaActive()) return;

	const dx = lookAt.x - camPos.x;
	const dz = lookAt.z - camPos.z;
	let horiz = Math.hypot(dx, dz);
	/**
	 * Kamerę prawie nad punktem look — bez early-out (to dawało top-down).
	 * Wypchnij look w poziomie wzdłuż istniejącego wektora / +Z.
	 */
	if (horiz < 0.35) {
		if (horiz < 1e-5) {
			lookAt.x = camPos.x;
			lookAt.z = camPos.z + 0.35;
		} else {
			const s = 0.35 / horiz;
			lookAt.x = camPos.x + dx * s;
			lookAt.z = camPos.z + dz * s;
		}
		horiz = 0.35;
	}
	const minLookY =
		camPos.y +
		horiz * Math.tan(THREE.MathUtils.degToRad(maxPitchDownDeg));
	if (lookAt.y < minLookY) {
		lookAt.y = minLookY;
	}
}

/**
 * Trzymaj kamerę za autem w XZ — nigdy prawie nad autem (widok z góry,
 * auta jak kropki, same name-tagi).
 */
export function enforceMinCameraDistXZ(
	camPos: THREE.Vector3,
	carPos: THREE.Vector3,
	behindDir: THREE.Vector3,
	minDistXZ: number = PLAYER_FRAME.minCamDistXZ,
): void {
	if (isMeridianArenaActive()) return;
	const dx = camPos.x - carPos.x;
	const dz = camPos.z - carPos.z;
	const distXZ = Math.hypot(dx, dz);
	if (distXZ >= minDistXZ) return;

	_clampDir.set(behindDir.x, 0, behindDir.z);
	if (_clampDir.lengthSq() < 1e-6) {
		if (distXZ > 1e-5) _clampDir.set(dx, 0, dz).normalize();
		else _clampDir.set(0, 0, 1);
	} else {
		_clampDir.normalize();
	}
	camPos.x = carPos.x + _clampDir.x * minDistXZ;
	camPos.z = carPos.z + _clampDir.z * minDistXZ;
}

/**
 * Soccar: trzymaj kamerę wewnątrz areny.
 * Jeśli target wychodzi poza box — skróć dystans wzdłuż wektora car→cam
 * (miękka kolizja ze ścianą), zamiast tylko twardo przycinać XYZ.
 */
export function clampCameraInsideSoccar(
	pos: THREE.Vector3,
	carPos?: THREE.Vector3,
	marginXZ = 2.2,
): void {
	if (isMeridianArenaActive()) return;

	const maxX = Math.max(4, RL_ARENA.HALF_WIDTH - marginXZ);
	const maxZ = Math.max(
		4,
		RL_ARENA.HALF_LENGTH +
			Math.min(2.8, RL_ARENA.GOAL_DEPTH * 0.28) -
			marginXZ,
	);
	const minY = PLAYFIELD_SURFACE_Y + 0.72;
	const maxY = RL_ARENA.HEIGHT - 2.5;

	const outside =
		Math.abs(pos.x) > maxX ||
		Math.abs(pos.z) > maxZ ||
		pos.y < minY ||
		pos.y > maxY;

	if (outside && carPos) {
		_clampDir.subVectors(pos, carPos);
		let len = _clampDir.length();
		if (len > 0.35) {
			_clampDir.multiplyScalar(1 / len);
			/** Binary search: najdalszy punkt na odcinku car→desired w boxie. */
			let lo = 0.5;
			let hi = len;
			for (let i = 0; i < 10; i++) {
				const mid = (lo + hi) * 0.5;
				_clampInward.copy(carPos).addScaledVector(_clampDir, mid);
				const ok =
					Math.abs(_clampInward.x) <= maxX &&
					Math.abs(_clampInward.z) <= maxZ &&
					_clampInward.y >= minY &&
					_clampInward.y <= maxY;
				if (ok) lo = mid;
				else hi = mid;
			}
			pos.copy(carPos).addScaledVector(_clampDir, lo);
		}
	}

	pos.x = THREE.MathUtils.clamp(pos.x, -maxX, maxX);
	pos.z = THREE.MathUtils.clamp(pos.z, -maxZ, maxZ);
	pos.y = THREE.MathUtils.clamp(pos.y, minY, maxY);
}

	/**
	 * Soft bias do RL_CAMERA.angleDeg (ujemny = pitch w dół, auto w kadrze).
	 * Słabe — framing auta ma wygrywać; bez ciągłego ciągnięcia look w niebo.
	 */
export function applyChaseAngleBias(
	camPos: THREE.Vector3,
	lookAt: THREE.Vector3,
	ballPos: THREE.Vector3,
	carPos: THREE.Vector3,
	_speedT = 0,
): void {
	if (isMeridianArenaActive()) return;
	if (ballPos.y - carPos.y > 4) return;

	const dx = lookAt.x - camPos.x;
	const dz = lookAt.z - camPos.z;
	const horiz = Math.hypot(dx, dz);
	if (horiz < 0.2) return;

	const desiredY =
		camPos.y + horiz * Math.tan(THREE.MathUtils.degToRad(CAMERA_ANGLE));
	lookAt.y = THREE.MathUtils.lerp(lookAt.y, desiredY, 0.055);
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
	countdownCamBlend = 1,
	/** false = powietrze (air pitch W/S). Nie mylić z wheelsGrounded — ray hit ≠ grounded. */
	onGround = true,
): void {
	/** Shake z poprzedniej klatki NIE może wchodzić w spring damp. */
	if (state.shakeApplied.lengthSq() > 1e-12) {
		camera.position.sub(state.shakeApplied);
		state.shakeApplied.set(0, 0, 0);
	}

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
	const airborne = !onGround && !isFlipping;

	/**
	 * Heading na ziemi — rzut forward.
	 * W powietrzu: CAŁKOWITY freeze (W/S = pitch nie może ruszyć yaw kamery).
	 * A/D air-yaw: celowo też nie kręci chase w powietrzu — RL TPP trzyma
	 * orbitę z takeoff; inaczej pitch+numeryka quat dawały „pływający” kąt.
	 */
	if (!isFlipping && !airborne) {
		const horizSq =
			_carForward.x * _carForward.x + _carForward.z * _carForward.z;
		if (horizSq > 0.12) {
			flatCarForward(_carForward, _flatForward);
			state.lastFlatForward.copy(_flatForward);
		}
	}

	if (isFlipping) {
		state.airCamActive = false;
		if (!state.flipCamActive) {
			state.flipCamActive = true;
			if (state.lastFlatForward.lengthSq() < 1e-6) {
				carHorizontalForwardFromQuat(carQuat, state.lastFlatForward);
				state.lastFlatForward.y = 0;
				if (state.lastFlatForward.lengthSq() > 1e-6) {
					state.lastFlatForward.normalize();
				} else {
					state.lastFlatForward.set(0, 0, 1);
				}
			}
			state.flipCamLookY = carPos.y + PLAYER_TPP.carLookLift;
			state.flipCamHeightY = carPos.y + PLAYER_TPP.heightOffset;
			state.flipCamFov = state.currentHorizontalFov;
			state.frameLookOffset.set(0, 0, 0);
			state.framePan.set(0, 0, 0);
			state.posVelocity.set(0, 0, 0);
		}
	} else if (state.flipCamActive) {
		state.flipCamActive = false;
	}

	if (airborne) {
		if (!state.airCamActive) {
			state.airCamActive = true;
			state.airCamForward.copy(state.lastFlatForward);
			if (state.airCamForward.lengthSq() < 1e-6) {
				flatCarForward(_carForward, state.airCamForward);
			}
			if (state.airCamForward.lengthSq() < 1e-6) {
				state.airCamForward.set(0, 0, 1);
			} else {
				state.airCamForward.y = 0;
				state.airCamForward.normalize();
			}
			state.lastFlatForward.copy(state.airCamForward);
			/** Pitch z bieżącego look — potem trzymany niezależnie od nosa. */
			camera.getWorldDirection(_camDir);
			const h = Math.hypot(_camDir.x, _camDir.z);
			state.airCamPitchRad =
				h > 1e-4
					? Math.atan2(_camDir.y, h)
					: THREE.MathUtils.degToRad(CAMERA_ANGLE);
			state.frameLookOffset.set(0, 0, 0);
			state.framePan.set(0, 0, 0);
			state.posVelocity.set(0, 0, 0);
		}
		state.lastFlatForward.copy(state.airCamForward);
	} else if (state.airCamActive) {
		state.airCamActive = false;
	}

	const distance = isBallCam
		? PLAYER_TPP.ballCamDistance
		: PLAYER_TPP.carCamDistance;

	const heightOverride = state.flipCamActive
		? state.flipCamHeightY
		: undefined;
	const lookYOverride = state.flipCamActive
		? state.flipCamLookY
		: undefined;

	/** Flip / air: bez predykcji z impulsu — inaczej target skacze w bok. */
	const chaseAnchor =
		state.flipCamActive || airborne
			? _predictedCar.copy(carPos)
			: predictCarPosForChase(carPos, carVelocity, boosting, _predictedCar);

	computePlayerTppTarget(
		chaseAnchor,
		ballPos,
		state.lastFlatForward,
		distance,
		/** Air: zawsze −forward (nie ball-line). */
		airborne ? false : isBallCam,
		heightOverride,
	);

	/**
	 * Countdown / kickoff-lock: pozycja ZA AUTEM (nie ball-line).
	 * Spring + screen-framing zostawiały auto po prawej (menu orbit / offset).
	 */
	const countdownPosT = THREE.MathUtils.clamp(countdownCamBlend, 0, 1);
	const kickoffCamLock =
		countdownPosT < 0.99 && !isMeridianArenaActive();
	if (kickoffCamLock) {
		flatCarForward(_carForward, _flatForward);
		if (_flatForward.lengthSq() > 1e-6 && !isFlipping && !airborne) {
			state.lastFlatForward.copy(_flatForward);
		}
		const wide = THREE.MathUtils.clamp((camera.aspect - 1.75) / 0.9, 0, 1);
		const kickDist = PLAYER_TPP.kickoffDistance - wide * 1.1;
		computePlayerTppTarget(
			_predictedCar,
			ballPos,
			state.lastFlatForward,
			kickDist,
			false,
			heightOverride ??
				_predictedCar.y + kickoffCamHeightForAspect(camera.aspect),
		);
		_targetPos.y =
			_predictedCar.y + kickoffCamHeightForAspect(camera.aspect);
		/** Twardy lock — bez springa z orbity menu. */
		camera.position.copy(_targetPos);
		state.posVelocity.set(0, 0, 0);
		state.framePan.set(0, 0, 0);
		state.frameLookOffset.set(0, 0, 0);
	}

	/** Vel-chase wyłączony — ball-cam szarpał przy W (free cam OK). */

	const verticalSep = Math.abs(ballPos.y - carPos.y);
	const speedXZ = Math.hypot(carVelocity.x, carVelocity.z);
	const speedT = THREE.MathUtils.clamp(speedXZ / RL_CAR.maxSpeed, 0, 1);

	/**
	 * Kickoff-lock: look + pozycja twarde — bez springa / ball-look / look-smooth.
	 */
	if (kickoffCamLock) {
		flatCarForward(state.lastFlatForward, _flatForward);
		const lookY = kickoffLookYForAspect(camera.aspect);
		_lookAt.set(
			carPos.x + _flatForward.x * PLAYER_TPP.kickoffLookAhead,
			carPos.y + lookY + 0.1,
			carPos.z + _flatForward.z * PLAYER_TPP.kickoffLookAhead,
		);
		clampLookAtPitch(camera.position, _lookAt);
		state.smoothedLookAt.copy(_lookAt);
		state.initialized = true;
		if (!isMeridianArenaActive()) {
			clampCameraInsideSoccar(camera.position, carPos);
		}
		camera.up.set(0, 1, 0);
		camera.lookAt(state.smoothedLookAt);
		return;
	}

	/**
	 * AIR LOCK (skok + W/S): twardy pose jak kickoff — zero springa / framingu.
	 * Kamera za autem wzdłuż zamrożonego heading, pitch look = airCamPitchRad.
	 */
	if (airborne && !isMeridianArenaActive()) {
		_targetPos.y = carPos.y + PLAYER_TPP.heightOffset;
		camera.position.copy(_targetPos);
		state.posVelocity.set(0, 0, 0);
		state.framePan.set(0, 0, 0);
		state.frameLookOffset.set(0, 0, 0);
		enforceMinCameraDistXZ(camera.position, carPos, _clampDir);
		clampCameraInsideSoccar(camera.position, carPos);

		const ahead = PLAYER_TPP.carLookAhead;
		_lookAt.set(
			carPos.x + state.airCamForward.x * ahead,
			0,
			carPos.z + state.airCamForward.z * ahead,
		);
		const dx = _lookAt.x - camera.position.x;
		const dz = _lookAt.z - camera.position.z;
		const horiz = Math.hypot(dx, dz);
		_lookAt.y =
			camera.position.y +
			(horiz > 0.2
				? horiz * Math.tan(state.airCamPitchRad)
				: PLAYER_TPP.carLookLift);
		clampLookAtPitch(camera.position, _lookAt);
		state.smoothedLookAt.copy(_lookAt);
		state.initialized = true;
		camera.up.set(0, 1, 0);
		camera.lookAt(state.smoothedLookAt);
		return;
	}

	if (!state.initialized) {
		camera.position.copy(_targetPos);
		computeTppLookAt(
			carPos,
			ballPos,
			state.lastFlatForward,
			isBallCam,
			lookYOverride,
			undefined,
			Math.hypot(carVelocity.x, carVelocity.z),
		);
		if (isBallCam) {
			applyChaseAngleBias(camera.position, _lookAt, ballPos, carPos, 0);
		}
		clampLookAtPitch(camera.position, _lookAt);
		state.smoothedLookAt.copy(_lookAt);
		state.posVelocity.set(0, 0, 0);
		state.initialized = true;
	}

	let smoothTime = isBallCam
		? verticalSep > 2.5
			? PLAYER_TPP.posSmoothTimeAerial
			: PLAYER_TPP.posSmoothTimeBall
		: PLAYER_TPP.posSmoothTimeCar;
	/**
	 * Ball-cam: wolniejszy spring przy niskiej V — linia piłka↔auto obraca się
	 * przy W; ostry spring = szarpnięcie (tego nie ma free cam).
	 */
	const springT = isBallCam
		? THREE.MathUtils.smoothstep(speedT, 0.4, 0.95)
		: THREE.MathUtils.smoothstep(speedT, 0.2, 0.85);
	smoothTime *= THREE.MathUtils.lerp(
		1,
		isBallCam ? 0.72 : 0.55,
		springT * springT,
	);
	/** Ciągłe spowolnienie przy niskiej V — bez skoku przy speedT=0.3. */
	if (isBallCam) {
		const lowEase = 1 - THREE.MathUtils.smoothstep(speedT, 0.08, 0.42);
		smoothTime *= THREE.MathUtils.lerp(1, 1.35, lowEase);
	}
	if (boosting) smoothTime *= 0.72;
	const maxCamSpeed =
		PLAYER_TPP.maxCameraSpeed *
		THREE.MathUtils.lerp(1, isBallCam ? 1.2 : 1.55, springT) *
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

	/** Nigdy prawie nad autem — top-down = niewidoczne meshe, same tagi. */
	_clampDir.subVectors(camera.position, carPos);
	enforceMinCameraDistXZ(camera.position, carPos, _clampDir);
	if (!isMeridianArenaActive()) {
		clampCameraInsideSoccar(camera.position, carPos);
	}

	const maxBallBlend = state.flipCamActive
		? 0
		: speedXZ < 1.2
			? 0.05
			: undefined;
	computeTppLookAt(
		carPos,
		ballPos,
		state.lastFlatForward,
		state.flipCamActive ? false : isBallCam,
		lookYOverride,
		maxBallBlend,
		speedXZ,
	);
	if (!isMeridianArenaActive() && !state.flipCamActive) {
		_lookAt.y += isBallCam
			? PLAYER_TPP.ballCamHorizonLift
			: PLAYER_TPP.carCamHorizonLift;
	}
	if (isBallCam && !state.flipCamActive) {
		applyChaseAngleBias(camera.position, _lookAt, ballPos, carPos, speedT);
	}
	clampLookAtPitch(camera.position, _lookAt);
	const lookHz = state.flipCamActive
		? PLAYER_TPP.lookSmoothHz * 2.2
		: isBallCam
			? PLAYER_TPP.lookSmoothHz * 0.48
			: PLAYER_TPP.lookSmoothHz;
	const lookAlpha = 1 - Math.exp(-lookHz * dt);
	state.smoothedLookAt.lerp(_lookAt, lookAlpha);
	clampLookAtPitch(camera.position, state.smoothedLookAt);

	if (isMeridianArenaActive()) {
		clampPointInsideMeridian(camera.position, 3.2);
		meridianCameraUp(carPos, _camDir);
		camera.up.copy(_camDir);
	} else {
		clampCameraInsideSoccar(camera.position, carPos);
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
	const lookAt = computeTppLookAt(
		carPos,
		ballPos,
		orbitForward,
		isBallCam,
		undefined,
		undefined,
		0,
	);
	if (isBallCam) {
		applyChaseAngleBias(targetPos, lookAt, ballPos, carPos, 0);
	}
	clampLookAtPitch(targetPos, lookAt);
	if (!isMeridianArenaActive()) {
		clampCameraInsideSoccar(targetPos, carPos);
	}
	return { targetPos: targetPos.clone(), lookAt: lookAt.clone() };
}

/**
 * Kickoff / countdown — za autem wzdłuż forward (nie ball-line).
 * Ball-line przy diagonal kickoff daje widok z boku (~auto 45°, oś piłki ~34°).
 */
/** Kickoff cam height — lekki bump na ultrawide (hFOV już trzyma vFOV). */
export function kickoffCamHeightForAspect(aspect: number): number {
	const wide = THREE.MathUtils.clamp((aspect - 1.75) / 0.9, 0, 1);
	/** UW: trochę wyżej — niższa kamera = fisheye trawy na dole kadru. */
	return PLAYER_TPP.kickoffHeight + wide * 0.12;
}

export function kickoffLookYForAspect(aspect: number): number {
	const wide = THREE.MathUtils.clamp((aspect - 1.75) / 0.9, 0, 1);
	/**
	 * UW: lekko niższy lookAt — hFOV compensation trzyma vFOV;
	 * nie schodź agresywnie (stare −0.35 = lufa w trawę).
	 */
	return PLAYER_TPP.kickoffLookY - wide * 0.12;
}

export function sampleKickoffChaseCameraTargets(
	carPos: THREE.Vector3,
	orbitForward: THREE.Vector3,
	ballPos: THREE.Vector3,
	aspect = 16 / 9,
): { targetPos: THREE.Vector3; lookAt: THREE.Vector3 } {
	flatCarForward(orbitForward, _dirToCar);
	/**
	 * Ultrawide: hFOV compensation poszerza kadr — tylko lekko bliżej.
	 */
	const wide = THREE.MathUtils.clamp((aspect - 1.75) / 0.9, 0, 1);
	const distance = PLAYER_TPP.kickoffDistance - wide * 0.35;
	const height = kickoffCamHeightForAspect(aspect);
	const lookY = kickoffLookYForAspect(aspect);
	const lookAhead = PLAYER_TPP.kickoffLookAhead * (1 - wide * 0.15);
	const targetPos = _targetPos.set(
		carPos.x - _dirToCar.x * distance,
		carPos.y + height,
		carPos.z - _dirToCar.z * distance,
	);
	void ballPos;

	const lookAt = _lookAt.set(
		carPos.x + _dirToCar.x * lookAhead,
		carPos.y + lookY,
		carPos.z + _dirToCar.z * lookAhead,
	);
	clampLookAtPitch(targetPos, lookAt);
	if (!isMeridianArenaActive()) {
		clampCameraInsideSoccar(targetPos, carPos);
	}
	return { targetPos: targetPos.clone(), lookAt: lookAt.clone() };
}

/**
 * Live match pose (to, co followPlayer celuje przy postoju) — z horizon lift.
 * Bez tego countdown lerp ≈ no-op: kickoff i sampleChase mają ten sam target,
 * a preferY-correction spłaszcza lookAt do tego samego pitchu.
 */
export function sampleLiveMatchChaseCameraTargets(
	carPos: THREE.Vector3,
	orbitForward: THREE.Vector3,
	ballPos: THREE.Vector3,
	isBallCam: boolean,
): { targetPos: THREE.Vector3; lookAt: THREE.Vector3 } {
	const pose = sampleChaseCameraTargets(
		carPos,
		orbitForward,
		ballPos,
		isBallCam,
	);
	if (!isMeridianArenaActive()) {
		pose.lookAt.y += isBallCam
			? PLAYER_TPP.ballCamHorizonLift
			: PLAYER_TPP.carCamHorizonLift;
	}
	if (isBallCam) {
		applyChaseAngleBias(pose.targetPos, pose.lookAt, ballPos, carPos, 0);
	}
	clampLookAtPitch(pose.targetPos, pose.lookAt);
	if (!isMeridianArenaActive()) {
		clampCameraInsideSoccar(pose.targetPos, carPos);
	}
	return pose;
}

/**
 * Odliczanie 5→1: pozycja lekko w stronę live, look ZOSTAJE wzdłuż forward auta.
 * Lerp look→piłka wypychał auto na bok kadru („krzywy samochód po prawej”).
 */
export function sampleCountdownChaseCameraTargets(
	carPos: THREE.Vector3,
	orbitForward: THREE.Vector3,
	ballPos: THREE.Vector3,
	isBallCam: boolean,
	matchBlend: number,
	aspect = 16 / 9,
): { targetPos: THREE.Vector3; lookAt: THREE.Vector3 } {
	const t = THREE.MathUtils.clamp(matchBlend, 0, 1);
	const kick = sampleKickoffChaseCameraTargets(
		carPos,
		orbitForward,
		ballPos,
		aspect,
	);
	if (t <= 0.001) {
		return kick;
	}
	if (t >= 0.999) {
		return sampleLiveMatchChaseCameraTargets(
			carPos,
			orbitForward,
			ballPos,
			isBallCam,
		);
	}
	const match = sampleLiveMatchChaseCameraTargets(
		carPos,
		orbitForward,
		ballPos,
		isBallCam,
	);
	return {
		targetPos: kick.targetPos.lerp(match.targetPos, t * 0.4),
		lookAt: kick.lookAt.clone(),
	};
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
	_wheelsGrounded = 4,
	goalFovBoost = 0,
	isFlipping = false,
	carVelocity = _flatVel.set(0, 0, 0),
	countdownCamBlend = 1,
	/** false gdy !player.isOnGround() — air pitch W/S. */
	onGround = true,
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
		countdownCamBlend,
		onGround,
	);

	/** Meridian: framing world-up psuje kadr na ścianie/suficie. */
	if (!isMeridianArenaActive()) {
		/**
		 * Kickoff-lock: zero framingu / floor-guarda — zostaw twardy pose z TPP.
		 */
		if (countdownCamBlend < 0.99) {
			state.frameLookOffset.set(0, 0, 0);
			state.framePan.set(0, 0, 0);
			camera.up.set(0, 1, 0);
			camera.lookAt(state.smoothedLookAt);
		} else if (state.flipCamActive || !onGround) {
			/**
			 * Flip / airborne lock: zero framingu / floor-guarda.
			 * Pitch nosa (W/S) + tumble nie mogą kręcić lookAt-panem.
			 */
			state.frameLookOffset.set(0, 0, 0);
			state.framePan.set(0, 0, 0);
			clampCameraInsideSoccar(camera.position, carPos);
			camera.up.set(0, 1, 0);
			camera.lookAt(state.smoothedLookAt);
		} else {
		const preferY = boosting
			? PLAYER_FRAME.preferYBoosting
			: PLAYER_FRAME.preferY;
		/** Pełny framing zawsze — ball-cam nie może zostawiać auta na boku. */
		const frameGain = 1;
		if (frameGain < 0.04) {
			const fade = Math.exp(-5 * dt);
			state.frameLookOffset.multiplyScalar(fade);
			state.framePan.multiplyScalar(fade);
			camera.up.set(0, 1, 0);
			camera.lookAt(state.smoothedLookAt);
		} else {
			applyPlayerScreenFraming(
				camera,
				carPos,
				state,
				dt,
				speedXZ,
				preferY,
			);
			if (frameGain < 0.999) {
				state.frameLookOffset.multiplyScalar(frameGain);
				state.framePan.multiplyScalar(frameGain);
				camera.up.set(0, 1, 0);
				camera.lookAt(
					_framedLook
						.copy(state.smoothedLookAt)
						.add(state.frameLookOffset),
				);
			}
		}
		clampCameraInsideSoccar(camera.position, carPos);

		/**
		 * Auto przy dolnej krawędzi — dolly wstecz (nie podnoś Y).
		 */
		camera.updateMatrixWorld(true);
		_ndc.copy(carPos).project(camera);
		const floorGuard = boosting
			? PLAYER_FRAME.floorGuardY + 0.06
			: PLAYER_FRAME.floorGuardY;
		const allowFloor =
			boosting || _ndc.y < floorGuard - 0.08;
		if (
			allowFloor &&
			(_ndc.y < floorGuard || (boosting && _ndc.y < -0.58))
		) {
			for (let i = 0; i < 3; i++) {
				camera.updateMatrixWorld(true);
				_ndc.copy(carPos).project(camera);
				if (_ndc.y >= preferY - 0.04) break;
				const err = preferY - _ndc.y;
				_clampDir.subVectors(camera.position, carPos);
				_clampDir.y = 0;
				if (_clampDir.lengthSq() < 1e-4) {
					flatCarForward(state.lastFlatForward, _clampDir);
					_clampDir.multiplyScalar(-1);
				} else {
					_clampDir.normalize();
				}
				const step = Math.min(err * 1.6, boosting ? 0.16 : 0.2);
				camera.position.addScaledVector(_clampDir, step);
				camera.position.y = Math.max(
					camera.position.y,
					carPos.y + PLAYER_TPP.heightOffset * 0.92,
				);
				const lookBefore = state.smoothedLookAt.y;
				state.smoothedLookAt.y -= err * 0.12;
				state.smoothedLookAt.y = Math.max(
					state.smoothedLookAt.y,
					carPos.y + 0.35,
				);
				clampLookAtPitch(
					camera.position,
					state.smoothedLookAt,
					PLAYER_FRAME.maxPitchDownDeg,
				);
				if (Math.abs(state.smoothedLookAt.y - lookBefore) < 0.01) {
					camera.position.addScaledVector(
						_clampDir,
						Math.min(err * 0.45, 0.12),
					);
				}
				camera.up.set(0, 1, 0);
				camera.lookAt(state.smoothedLookAt);
			}
		}
		/** Ostateczny clamp — framing nie może zostawić pitchu −15°. */
		clampLookAtPitch(
			camera.position,
			state.smoothedLookAt,
			PLAYER_FRAME.maxPitchDownDeg,
		);
		camera.up.set(0, 1, 0);
		camera.lookAt(
			_framedLook.copy(state.smoothedLookAt).add(state.frameLookOffset),
		);
		clampLookAtPitch(
			camera.position,
			_framedLook,
			PLAYER_FRAME.maxPitchDownDeg,
		);
		camera.lookAt(_framedLook);
		}
	}

	if (state.shakeIntensity > 0.001) {
		state.shakeIntensity *= 0.04 ** dt;
		const s = state.shakeIntensity;
		state.shakeApplied.set(
			(Math.random() - 0.5) * s * 0.08,
			(Math.random() - 0.5) * s * 0.05,
			(Math.random() - 0.5) * s * 0.08,
		);
		camera.position.add(state.shakeApplied);
		if (!isMeridianArenaActive()) {
			clampCameraInsideSoccar(camera.position, carPos);
		}
	} else {
		state.shakeIntensity = 0;
		state.shakeApplied.set(0, 0, 0);
	}

	const speedT = THREE.MathUtils.clamp(speed / RL_CAR.maxSpeed, 0, 1);
	const boostT = boosting ? 0.35 : 0;
	camera.updateMatrixWorld(true);
	_ndc.copy(carPos).project(camera);
	const lowInFrame = _ndc.y < PLAYER_FRAME.minY + 0.06;
	/** FOV punch dopiero przy realnej prędkości — nie przy pierwszym W. */
	const fovSpeedT =
		speedT < 0.22
			? 0
			: lowInFrame
				? speedT * 0.35
				: THREE.MathUtils.smoothstep(speedT, 0.22, 1);
	const meridianFov = isMeridianArenaActive() ? MERIDIAN_CAM.fovBoost : 0;
	/** Airborne: bez FOV punch z air-throttle (W) — wygląda jak zmiana kąta. */
	const targetHFov =
		state.flipCamActive || !onGround
			? state.flipCamActive && state.flipCamFov > 1
				? state.flipCamFov
				: state.currentHorizontalFov
			: THREE.MathUtils.lerp(
					baseHorizontalFov,
					MAX_HORIZONTAL_FOV,
					Math.max(
						fovSpeedT * 0.18,
						/** Boost nie rozszerza FOV gdy auto już nisko — ucinało z dołu. */
						boostT * (lowInFrame ? 0.05 : 0.55),
					),
				) +
				goalFovBoost +
				meridianFov;
	const fovLerp =
		state.flipCamActive || !onGround ? 1 : 1 - 0.001 ** (dt * 60);
	state.currentHorizontalFov = THREE.MathUtils.lerp(
		state.currentHorizontalFov,
		targetHFov,
		fovLerp,
	);
	const verticalFov = horizontalFovToVertical(
		horizontalFovForAspect(state.currentHorizontalFov, camera.aspect),
		camera.aspect,
	);
	if (Math.abs(camera.fov - verticalFov) > 0.02) {
		camera.fov = verticalFov;
		camera.updateProjectionMatrix();
	}
}
