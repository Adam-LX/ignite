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
import {
	isInsideGoalPocket,
	whichGoalPocket,
	type GoalPocketSide,
} from "./goalPocket";
import { RAMP_RUN } from "./perimeter/constants";
import {
	CLASSIC_CHASE_RIG,
	clampChaseRigFov,
	isBodyMountChaseRig,
	isOverheadChaseRig,
	isOverheadMountChaseRig,
	isSpectacleChaseRig,
	type ChaseRigParams,
} from "./cameraPresets";

export const CAMERA_DISTANCE = RL_CAMERA.distance;
export const CAMERA_HEIGHT = RL_CAMERA.height;
export const CAMERA_ANGLE = RL_CAMERA.angleDeg;
export const CAMERA_STIFFNESS = RL_CAMERA.stiffness;
/**
 * Wall / ramp chase — soft stiffness cap (pro wall-dash reads:
 * więcej pola, mniej „locked” orbit przy wjeździe).
 */
export const WALL_CHASE_STIFFNESS_CAP = 0.26;

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

/**
 * Framing auta — spec Pana Kamila:
 * całe auto u dołu ekranu, wycentrowane w X (Ball Cam i Free Cam tak samo).
 */
export const PLAYER_FRAME = {
	/**
	 * Preferowany NDC Y. Three.js: +1 góra, −1 dół.
	 * Auto w pełni widoczne u dołu (nie ucięte bumpers).
	 */
	preferY: -0.28,
	minY: -0.55,
	maxY: -0.08,
	maxAbsX: 0.1,
	/** Siła korekty lookAt w poziomie (world units per NDC error). */
	panGainX: 32,
	/** Pionowa korekta — umiarkowana, framing nie szarpie pitch. */
	panGainY: 8.5,
	/** Przy max speed: ile % pionowej korekty zostaje (0–1). */
	panGainYAtSpeed: 0.8,
	/** Miękkie dociągnięcie tylko blisko prefer (0–1). */
	softCenterPull: 0.32,
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
	minCamDistXZ: 2.45,
	/** Poza tą strefą NDC — pełna siła edge recovery (nie soft). */
	edgeHardX: 0.62,
	edgeHardY: 0.7,
	/** Przy boost: nieco wyżej w kadrze, bez ucięcia. */
	preferYBoosting: -0.22,
	/**
	 * Floor-guard: tylko gdy auto naprawdę tonie — inaczej walczy ze springiem.
	 */
	floorGuardY: -0.62,
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
	/**
	 * Minimalny czas trzymania flip-locka po starcie dodge’a.
	 * Bez tego sideflip może “wyglądać prosto” z up.y zanim heading/pitch
	 * faktycznie przestały się zmieniać i kamera dostaje widoczny skok.
	 */
	flipCamLockTimeS: number;
	flipCamLookY: number;
	flipCamHeightY: number;
	/** FOV na starcie flipa — impuls dodge nie zmienia projekcji. */
	flipCamFov: number;
	/** Pitch look zamrożony na starcie dodge (rad) — kąt nie pływa z Y auta. */
	flipCamPitchRad: number;
	/** Offset Y kamery względem auta (zamrożony) — śledzi skok, bez nurkowania. */
	flipCamHeightOff: number;
	flipCamLookOff: number;
	/** Dystans XZ kamera↔auto z klatki startu dodge — bez snapu do TPP. */
	flipCamDistXZ: number;
	/** lookAt − auto (XZ) z klatki startu — nie „za nosem”. */
	flipCamLookOffset: THREE.Vector3;
	/** Ball Cam: podczas dodge look zostaje na piłce. */
	flipCamBallLook: boolean;
	/**
	 * Histereza Ball/Free framing — unikaj popu przy camT≈0.5 mid-blend.
	 * true = Ball Cam pose (pro: Ball Cam większość meczu).
	 */
	ballCamFraming: boolean;
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
	/**
	 * Ball Cam: wygładzony kierunek „za autem na osi piłka→auto”.
	 * Bez tego orbit skacze przy gazie/skręcie (flip 180° gdy miniasz piłkę).
	 */
	ballOrbitDir: THREE.Vector3;
	ballOrbitReady: boolean;
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
		flipCamLockTimeS: 0,
		flipCamLookY: 0,
		flipCamHeightY: 0,
		flipCamFov: baseHorizontalFov,
		flipCamPitchRad: THREE.MathUtils.degToRad(CAMERA_ANGLE),
		flipCamHeightOff: 0,
		flipCamLookOff: 0,
		flipCamDistXZ: 0,
		flipCamLookOffset: new THREE.Vector3(),
		flipCamBallLook: false,
		ballCamFraming: true,
		airCamActive: false,
		airCamForward: new THREE.Vector3(0, 0, 1),
		airCamPitchRad: THREE.MathUtils.degToRad(CAMERA_ANGLE),
		smoothedLookAt: new THREE.Vector3(0, 0, 8),
		posVelocity: new THREE.Vector3(),
		framePan: new THREE.Vector3(),
		frameLookOffset: new THREE.Vector3(),
		ballOrbitDir: new THREE.Vector3(0, 0, -1),
		ballOrbitReady: false,
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
	state.flipCamLockTimeS = 0;
	state.flipCamLookY = 0;
	state.flipCamHeightY = 0;
	state.flipCamFov = 0;
	state.flipCamPitchRad = THREE.MathUtils.degToRad(CAMERA_ANGLE);
	state.flipCamHeightOff = 0;
	state.flipCamLookOff = 0;
	state.flipCamDistXZ = 0;
	state.flipCamLookOffset.set(0, 0, 0);
	state.flipCamBallLook = false;
	state.ballCamFraming = true;
	state.airCamActive = false;
	state.airCamForward.set(0, 0, 1);
	state.airCamPitchRad = THREE.MathUtils.degToRad(CAMERA_ANGLE);
	state.posVelocity.set(0, 0, 0);
	state.framePan.set(0, 0, 0);
	state.frameLookOffset.set(0, 0, 0);
	state.ballOrbitReady = false;
	state.ballOrbitDir.set(0, 0, -1);
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
const _lookOrbit = new THREE.Vector3();
const _yUp = new THREE.Vector3(0, 1, 0);
const _lookOrbitQ = new THREE.Quaternion();
const _dirToCar = new THREE.Vector3();
const _clampDir = new THREE.Vector3();
const _clampInward = new THREE.Vector3();

export const BASE_FOV = RL_CAMERA.horizontalFov;
const MAX_HORIZONTAL_FOV = RL_CAMERA.horizontalFovBoost;

/** Boost wpływa na kamerę dopiero przy realnej prędkości — inaczej auto „pływa” w kadrze. */
export function chaseBoostFxT(boosting: boolean, speedT: number): number {
	if (!boosting || speedT <= 0.14) return 0;
	return THREE.MathUtils.smoothstep(speedT, 0.14, 0.45);
}

const _camDir = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _flatVel = new THREE.Vector3();
const _predictedCar = new THREE.Vector3();
const _framedLook = new THREE.Vector3();
const _frameTargetOff = new THREE.Vector3();
const _horizonMat = new THREE.Matrix4();

/**
 * Chase TPP — rewrite pod spec Pana Kamila (Ball Cam / Free Cam).
 * Ten sam dystans/wysokość w obu trybach → auto w tym samym miejscu kadru;
 * różni się tylko kierunek „za autem” + lookAt.
 */
const PLAYER_TPP = {
	baseDistance: RL_CAMERA.distance,
	heightOffset: RL_CAMERA.height,
	/** Free Cam (Spacja) — za autem, look = przód auta. */
	carCamDistance: RL_CAMERA.distance,
	carLookLift: 0.55,
	/** Look ahead Free Cam (m). */
	carLookAhead: 2.8,
	carLookAheadMin: 1.8,
	/** Ball Cam (domyślna) — za autem względem piłki, look = piłka (środek kadru). */
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
	posSmoothTimeBall: 0.075,
	posSmoothTimeCar: 0.065,
	posSmoothTimeAerial: 0.065,
	/** Wygładzenie lookAt (Hz). */
	lookSmoothHz: 12,
	/** Max prędkość kamery (m/s). */
	maxCameraSpeed: 130,
	/** Soft-snap gdy kamera zostaje w tyle (m). */
	catchUpDist: 4,
	snapDistSq: 10 * 10,
	/** Niższy blend = auto bliżej środka kadru (piłka mniej „ciągnie” look). */
	ballLookBlendMin: 0.01,
	ballLookBlendMax: 0.035,
	aerialHeightFollow: 0.28,
	maxAerialHeightLift: 5.5,
	/** Extra lift lookAt przy prędkości — Free Cam. */
	speedHorizonLift: 0.06,
	/**
	 * Ball Cam: look ≈ piłka — bez sztucznego horizon lift
	 * (piłka ma być na środku kadru).
	 */
	ballCamHorizonLift: 0,
	/** Free Cam: lekki lift look ahead. */
	carCamHorizonLift: 0.12,
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
	/**
	 * Ball-line orbit — wygładzenie kątowe (Hz) + cap rad/s.
	 * Framing (look=piłka, preferY) bez zmian; tylko bez szarpania targetu.
	 */
	orbitSmoothHz: 7.5,
	orbitMaxRadPerSec: 4.2,
	/** Free Cam / heading na ziemi — lekki damp yaw (bez zmiany dystansu). */
	headingSmoothHz: 12,
	headingMaxRadPerSec: 5.5,
	/**
	 * Ball Cam dolly framing — jedna miękka korekta/klatkę (nie 4× hard snap).
	 * Spec Pana Kamila (preferY) zostaje; rate-limit usuwa walkę ze springiem.
	 */
	dollySoftHz: 10,
	dollyMaxStepM: 0.11,
} as const;

/**
 * Publiczna formuła feelu (Rocket Science #2): przy prędkości dystans rośnie
 * o (1−stiffness)×maxStretch, angle „otwiera się” o do +2°.
 */
export function chaseSpeedStretchM(speedT: number, stiffness: number = CAMERA_STIFFNESS): number {
	const t = THREE.MathUtils.clamp(speedT, 0, 1);
	const open = Math.max(0, 1 - stiffness);
	return open * RL_CAMERA.maxSpeedStretch * t * t;
}

export function chaseSpeedAngleDeg(speedT: number, stiffness: number = CAMERA_STIFFNESS): number {
	const t = THREE.MathUtils.clamp(speedT, 0, 1);
	const open = Math.max(0, 1 - stiffness);
	/** Angle staje się mniej ujemny (płyciej) przy prędkości — max +2° przy stiff=0. */
	return RL_CAMERA.angleDeg + open * 2 * t * t;
}

/** Soft stiffness na ścianie / rampie — wall-dash field awareness. */
export function chaseStiffnessForSurface(onWallSurface: boolean): number {
	return onWallSurface
		? Math.min(CAMERA_STIFFNESS, WALL_CHASE_STIFFNESS_CAP)
		: CAMERA_STIFFNESS;
}

/**
 * Histereza Ball↔Free framing (pro transition ~1.3 — bez popu w środku ease).
 * Enter Ball przy ≥0.58, stay Ball aż spadnie ≤0.42.
 */
export function tickBallCamFraming(wasBall: boolean, camT: number): boolean {
	const t = THREE.MathUtils.clamp(camT, 0, 1);
	return wasBall ? t > 0.42 : t >= 0.58;
}

/** Płynny blend Ball↔Free przy toggle — RL_CAMERA.transitionSpeed (~1.2 pro). */
export function tickBallCamBlendT(
	current: number,
	targetBallCam: boolean,
	dt: number,
): number {
	const target = targetBallCam ? 1 : 0;
	if (Math.abs(target - current) < 1e-4) return target;
	const rate = RL_CAMERA.transitionSpeed * 2.2;
	return THREE.MathUtils.damp(current, target, rate, dt);
}

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

/**
 * Zero-roll lookAt (world-up). Three.js lookAt gimbaluje, gdy look ≈ pion
 * (sideflip / ściana — horyzont „jedzie” z autem, klip 22-16).
 */
function applyWorldUpLook(
	camera: THREE.PerspectiveCamera,
	target: THREE.Vector3,
	orbitFwd: THREE.Vector3,
): void {
	if (isMeridianArenaActive()) {
		camera.lookAt(target);
		return;
	}

	const eye = camera.position;
	let dx = target.x - eye.x;
	let dy = target.y - eye.y;
	let dz = target.z - eye.z;
	let horiz = Math.hypot(dx, dz);
	if (horiz < 0.6) {
		let fx = orbitFwd.x;
		let fz = orbitFwd.z;
		let fl = Math.hypot(fx, fz);
		if (fl < 1e-5) {
			fx = horiz > 1e-5 ? dx / horiz : 0;
			fz = horiz > 1e-5 ? dz / horiz : 1;
			fl = 1;
		}
		dx = (fx / fl) * 2.6;
		dz = (fz / fl) * 2.6;
	}
	const len = Math.hypot(dx, dy, dz) || 1;
	const lx = dx / len;
	const ly = dy / len;
	const lz = dz / len;
	let zx = -lx;
	let zy = -ly;
	let zz = -lz;
	let xx = zz;
	let xz = -zx;
	let xl = Math.hypot(xx, xz);
	if (xl < 0.08) {
		let ox = orbitFwd.x;
		let oz = orbitFwd.z;
		const ol = Math.hypot(ox, oz) || 1;
		ox /= ol;
		oz /= ol;
		zx = -ox;
		zy = 0;
		zz = -oz;
		xx = zz;
		xz = -zx;
		xl = Math.hypot(xx, xz) || 1;
	}
	xx /= xl;
	xz /= xl;
	_camRight.set(xx, 0, xz);
	_camDir.set(zy * xz - zz * 0, zz * xx - zx * xz, zx * 0 - zy * xx);
	if (_camDir.lengthSq() < 1e-8) {
		_camDir.set(0, 1, 0);
	} else {
		_camDir.normalize();
	}
	_clampDir.set(zx, zy, zz);
	_horizonMat.makeBasis(_camRight, _camDir, _clampDir);
	camera.quaternion.setFromRotationMatrix(_horizonMat);
	camera.up.set(0, 1, 0);
	camera.updateMatrixWorld(true);
}

/**
 * Wygładzenie kierunku XZ (najkrótszy łuk) — orbit / heading bez skoków.
 * `current` jest normalizowany in-place.
 */
export function smoothFlatDirToward(
	current: THREE.Vector3,
	desired: THREE.Vector3,
	dt: number,
	smoothHz: number,
	maxRadPerSec: number,
): void {
	_dirToCar.set(desired.x, 0, desired.z);
	if (_dirToCar.lengthSq() < 1e-8) return;
	_dirToCar.normalize();

	current.y = 0;
	if (current.lengthSq() < 1e-8) {
		current.copy(_dirToCar);
		return;
	}
	current.normalize();

	const dot = THREE.MathUtils.clamp(
		current.x * _dirToCar.x + current.z * _dirToCar.z,
		-1,
		1,
	);
	const cross = current.x * _dirToCar.z - current.z * _dirToCar.x;
	let ang = Math.atan2(cross, dot);
	if (Math.abs(ang) < 1e-5) {
		current.copy(_dirToCar);
		return;
	}

	const alpha = 1 - Math.exp(-smoothHz * dt);
	let step = ang * alpha;
	const maxStep = maxRadPerSec * Math.max(dt, 1e-6);
	if (Math.abs(step) > maxStep) {
		step = Math.sign(step) * maxStep;
	}
	const c = Math.cos(step);
	const s = Math.sin(step);
	const x = current.x * c - current.z * s;
	const z = current.x * s + current.z * c;
	current.set(x, 0, z);
	if (current.lengthSq() > 1e-8) current.normalize();
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

/**
 * Idealny chase za autem; przy bandzie nie kolapsuj na auto —
 * trzymaj dystans w stronę środka boiska (klip 12:59: wariowanie przy wall).
 */
function resolveSafeChaseTarget(
	carPos: THREE.Vector3,
	flatForward: THREE.Vector3,
	distance: number,
	heightY: number,
	out: THREE.Vector3,
): THREE.Vector3 {
	flatCarForward(flatForward, _flatForward);
	out.set(
		carPos.x - _flatForward.x * distance,
		heightY,
		carPos.z - _flatForward.z * distance,
	);
	clampCameraInsideSoccar(out, carPos);
	const dx = out.x - carPos.x;
	const dz = out.z - carPos.z;
	const distXZ = Math.hypot(dx, dz);
	if (distXZ >= distance * 0.7) {
		out.y = Math.max(out.y, heightY);
		return out;
	}

	/** Clamp zjadł dystans — blend „za autem” + „do środka boiska”. */
	_clampDir.set(-carPos.x, 0, -carPos.z);
	if (_clampDir.lengthSq() < 1e-4) {
		_clampDir.set(-_flatForward.x, 0, -_flatForward.z);
	} else {
		_clampDir.normalize();
	}
	_camDir.set(-_flatForward.x, 0, -_flatForward.z);
	_clampDir.lerp(_camDir, 0.4);
	if (_clampDir.lengthSq() > 1e-6) _clampDir.normalize();
	else _clampDir.copy(_camDir);

	out.set(
		carPos.x + _clampDir.x * distance,
		Math.max(heightY, PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y + 0.75),
		carPos.z + _clampDir.z * distance,
	);
	clampCameraInsideSoccar(out, carPos);
	enforceMinCameraDistXZ(out, carPos, _clampDir, Math.max(2.2, distance * 0.82));
	out.y = Math.max(out.y, heightY, PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y + 0.5);
	return out;
}

/** Ball Cam: za autem na osi piłka→auto. Free Cam: za autem wzdłuż −forward. */
export function computePlayerTppTarget(
	carPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	carForward: THREE.Vector3,
	distance: number = PLAYER_TPP.baseDistance,
	isBallCam = false,
	heightYOverride?: number,
): THREE.Vector3 {
	flatCarForward(carForward, _flatForward);
	const heightY = heightYOverride ?? carPos.y + PLAYER_TPP.heightOffset;

	if (isMeridianArenaActive()) {
		return computeMeridianCamTarget(
			carPos,
			ballPos,
			carForward,
			isBallCam,
			_targetPos,
		);
	}

	if (isBallCam) {
		/**
		 * Za autem względem piłki: kamera na przedłużeniu ball→car.
		 * LookAt = piłka → piłka na środku; auto między kamerą a piłką = dół kadru.
		 */
		_dirToCar.set(carPos.x - ballPos.x, 0, carPos.z - ballPos.z);
		if (_dirToCar.lengthSq() < 0.36) {
			_dirToCar.copy(_flatForward).multiplyScalar(-1);
		} else {
			_dirToCar.normalize();
		}

		_targetPos.set(
			carPos.x + _dirToCar.x * distance,
			heightY,
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
		const bdx = _targetPos.x - carPos.x;
		const bdz = _targetPos.z - carPos.z;
		if (Math.hypot(bdx, bdz) < distance * 0.7) {
			resolveSafeChaseTarget(
				carPos,
				_flatForward,
				distance,
				_targetPos.y,
				_targetPos,
			);
		}
		enforcePocketChaseTarget(_targetPos, carPos);
		return _targetPos;
	}

	/** Free Cam: czysto za autem (−forward), z bezpiecznym wall recover. */
	resolveSafeChaseTarget(carPos, _flatForward, distance, heightY, _targetPos);
	enforcePocketChaseTarget(_targetPos, carPos);
	return _targetPos;
}

function computeTppLookAt(
	carPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	carForward: THREE.Vector3,
	isBallCam: boolean,
	lookYOverride?: number,
	_maxBallBlend?: number,
	_speedXZ = Number.POSITIVE_INFINITY,
): THREE.Vector3 {
	flatCarForward(carForward, _flatForward);

	if (isMeridianArenaActive()) {
		return computeMeridianCamLookAt(
			carPos,
			ballPos,
			carForward,
			isBallCam,
			_lookAt,
		);
	}

	if (!isBallCam) {
		/** Free Cam: wycentrowany kierunek jazdy (przód auta). */
		const ahead = PLAYER_TPP.carLookAhead;
		return _lookAt.set(
			carPos.x + _flatForward.x * ahead,
			lookYOverride ?? carPos.y + PLAYER_TPP.carLookLift,
			carPos.z + _flatForward.z * ahead,
		);
	}

	/**
	 * Ball Cam: piłka na środku kadru.
	 * Lekki blend z punktem przed autem przy bardzo bliskiej piłce (unikaj flip look).
	 */
	const hSep = Math.hypot(ballPos.x - carPos.x, ballPos.z - carPos.z);
	if (hSep < 0.8 && Math.abs(ballPos.y - carPos.y) < 1.2) {
		return _lookAt.set(
			carPos.x + _flatForward.x * PLAYER_TPP.carLookAhead * 0.55,
			lookYOverride ?? carPos.y + PLAYER_TPP.carLookLift,
			carPos.z + _flatForward.z * PLAYER_TPP.carLookAhead * 0.55,
		);
	}

	return _lookAt.set(
		ballPos.x,
		lookYOverride ?? ballPos.y,
		ballPos.z,
	);
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
	if (horiz < 0.5) {
		if (horiz < 1e-5) {
			lookAt.x = camPos.x;
			lookAt.z = camPos.z + 0.5;
		} else {
			const s = 0.5 / horiz;
			lookAt.x = camPos.x + dx * s;
			lookAt.z = camPos.z + dz * s;
		}
		horiz = 0.5;
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
 * ── Soccar camera contract (stable) ─────────────────────────────────
 *
 * MIDFIELD: RL chase + AABB. minY≈1.35. maxZ≈halfLength−1.5.
 * POCKET: auto w kieszeni LUB cam za HALF_LENGTH → placePocketCamera.
 * Shell bramki (SoccarShell) jest rideable — kamera nie walczy z Meshy floor.
 * Jedyny egzekutor: finalizeSoccarCamera.
 */
/** Midfield: max |z| kamery względem linii bramkowej. */
const CAM_FIELD_STANDOFF = 1.5;
/** Pocket pose: kamera cofnięta od linii na boisko (nie trigger pocket). */
const CAM_POCKET_FIELD_LIMIT = 4.2;
const CAM_MID_MIN_Y = 1.35;
const CAM_POCKET_MIN_Y = 2.4;
const CAM_POCKET_BEHIND = 4.5;
/**
 * Keep-out od słupków — grube rury SoccarShell (tubeR≈0.38 + kołnierz).
 * Za mały = Free Cam / chase w meshu przy bramce (klip F9).
 */
const CAM_POST_KEEP_R = 2.55;
/** Keep-out od styku słupek↔ściana boczna. */
const CAM_GOAL_SIDE_KEEP = 2.15;
/**
 * Margin od zewnętrznej krawędzi.
 * Musi być ≥ RAMP_RUN — inaczej kamera siedzi w meshu rampy (pomarańczowa plama).
 */
const CAM_WALL_MARGIN = Math.max(2.2, RAMP_RUN + 1.15);

export function clampCameraInsideSoccar(
	pos: THREE.Vector3,
	carPos?: THREE.Vector3,
	marginXZ = CAM_WALL_MARGIN,
): void {
	if (isMeridianArenaActive()) return;

	const pocket = carPos ? isInsideGoalPocket(carPos, 0.6) : false;
	/**
	 * Boki: zawsze wall margin (rampa).
	 * Z: w kieszeni trzymamy się blisko linii (standoff 1.5);
	 * poza kieszenią ten sam keep-out co boki — inaczej kamera wjeżdża
	 * w ćwiartkę przy bramce (klip F9: pomarańczowa plama ~9–16 s).
	 */
	const zMargin = pocket
		? CAM_FIELD_STANDOFF
		: Math.max(CAM_FIELD_STANDOFF, marginXZ);
	const maxX = Math.max(4, RL_ARENA.HALF_WIDTH - marginXZ);
	const maxZ = Math.max(4, RL_ARENA.HALF_LENGTH - zMargin);
	const minY =
		PLAYFIELD_SURFACE_Y + (pocket ? CAM_POCKET_MIN_Y : CAM_MID_MIN_Y);
	const maxY = RL_ARENA.HEIGHT - 2.5;

	pos.y = THREE.MathUtils.clamp(Math.max(pos.y, minY), minY, maxY);

	const outside =
		Math.abs(pos.x) > maxX || Math.abs(pos.z) > maxZ || pos.y > maxY;

	if (outside && carPos) {
		_clampDir.subVectors(pos, carPos);
		_clampDir.y = 0;
		let len = _clampDir.length();
		if (len > 0.35) {
			_clampDir.multiplyScalar(1 / len);
			let lo = Math.min(len, PLAYER_FRAME.minCamDistXZ);
			let hi = len;
			for (let i = 0; i < 10; i++) {
				const mid = (lo + hi) * 0.5;
				_clampInward.set(
					carPos.x + _clampDir.x * mid,
					pos.y,
					carPos.z + _clampDir.z * mid,
				);
				const ok =
					Math.abs(_clampInward.x) <= maxX &&
					Math.abs(_clampInward.z) <= maxZ &&
					!isPastFieldGoalLimit(_clampInward);
				if (ok) lo = mid;
				else hi = mid;
			}
			pos.x = carPos.x + _clampDir.x * lo;
			pos.z = carPos.z + _clampDir.z * lo;
		}
	}

	pos.x = THREE.MathUtils.clamp(pos.x, -maxX, maxX);
	pos.z = THREE.MathUtils.clamp(pos.z, -maxZ, maxZ);
	pos.y = THREE.MathUtils.clamp(pos.y, minY, maxY);
	pushOutOfGoalMouth(pos);
	pushAwayFromGoalPosts(pos);
	pushAwayFromGoalCrossbar(pos);
	pushAwayFromGoalSideWalls(pos);
	pushOutOfGoalMouth(pos);
	if (carPos) {
		pos.y = Math.max(
			pos.y,
			PLAYFIELD_SURFACE_Y + (pocket ? CAM_POCKET_MIN_Y : CAM_MID_MIN_Y),
			carPos.y + PLAYER_TPP.heightOffset * (pocket ? 1 : 0.95),
		);
	}
}

function goalSideOf(pos: THREE.Vector3): GoalPocketSide {
	return pos.z >= 0 ? "orange" : "blue";
}

function fieldLimitZ(side: GoalPocketSide): number {
	const zSign = side === "orange" ? 1 : -1;
	return zSign * (RL_ARENA.HALF_LENGTH - CAM_POCKET_FIELD_LIMIT);
}

/** Midfield keep-out: za limitem boiska przed linią (nie mylić z pocket). */
function isPastFieldGoalLimit(pos: THREE.Vector3): boolean {
	const hl = RL_ARENA.HALF_LENGTH;
	const endHalfX = RL_ARENA.HALF_WIDTH - RL_ARENA.CORNER_CUT + 3.5;
	if (Math.abs(pos.x) > endHalfX) return false;
	const mouthZ = hl - CAM_FIELD_STANDOFF;
	return pos.z > mouthZ || pos.z < -mouthZ;
}

/** Prawdziwy wjazd za linię bramkową — trigger hard pocket pose. */
function isPastGoalLine(pos: THREE.Vector3): boolean {
	return Math.abs(pos.z) > RL_ARENA.HALF_LENGTH + 0.04;
}

function pushOutOfGoalMouth(pos: THREE.Vector3): void {
	const hl = RL_ARENA.HALF_LENGTH;
	const endHalfX = RL_ARENA.HALF_WIDTH - RL_ARENA.CORNER_CUT + 3.5;
	const mouthZ = hl - CAM_FIELD_STANDOFF;
	if (Math.abs(pos.x) > endHalfX) return;
	if (pos.z > mouthZ) pos.z = mouthZ;
	else if (pos.z < -mouthZ) pos.z = -mouthZ;
}

function pushAwayFromGoalPosts(pos: THREE.Vector3): void {
	const hl = RL_ARENA.HALF_LENGTH;
	const halfW = RL_ARENA.GOAL_WIDTH * 0.5;
	const keepRSq = CAM_POST_KEEP_R * CAM_POST_KEEP_R;
	for (const zSign of [-1, 1] as const) {
		const pz = zSign * hl;
		for (const px of [-halfW, halfW]) {
			const dx = pos.x - px;
			const dz = pos.z - pz;
			const dSq = dx * dx + dz * dz;
			if (dSq >= keepRSq || dSq < 1e-8) continue;
			const s = CAM_POST_KEEP_R / Math.sqrt(dSq);
			pos.x = px + dx * s;
			pos.z = pz + dz * s;
		}
	}
}

/**
 * Poprzeczka / portal — nie siadaj w rurze przy |x| w świetle (klip F9 ~13 s).
 */
function pushAwayFromGoalCrossbar(pos: THREE.Vector3): void {
	const hl = RL_ARENA.HALF_LENGTH;
	const halfW = RL_ARENA.GOAL_WIDTH * 0.5 + 0.8;
	if (Math.abs(pos.x) > halfW) return;
	const keep = CAM_POST_KEEP_R;
	const barY = RL_ARENA.GOAL_HEIGHT;
	if (pos.y < barY - keep * 0.9) return;
	for (const zSign of [-1, 1] as const) {
		const pz = zSign * hl;
		if (Math.abs(pos.z - pz) >= keep) continue;
		pos.z = pz - zSign * keep;
	}
}

/**
 * Korytarz bramki: nie siadaj w styku słupek↔ściana boczna (wall-fill).
 * W strefie end-zone trzymaj X wewnątrz ust albo wyraźnie z dala od linii.
 */
function pushAwayFromGoalSideWalls(pos: THREE.Vector3): void {
	const hl = RL_ARENA.HALF_LENGTH;
	const halfW = RL_ARENA.GOAL_WIDTH * 0.5;
	const endZone = 7;
	if (Math.abs(pos.z) < hl - endZone) return;

	const absX = Math.abs(pos.x);
	const inner = halfW - CAM_GOAL_SIDE_KEEP;
	const outer = halfW + CAM_GOAL_SIDE_KEEP;
	if (absX >= inner && absX <= outer) {
		pos.x = Math.sign(pos.x || 1) * Math.max(0.05, inner - 0.15);
	}

	const zSign = pos.z >= 0 ? 1 : -1;
	const limit = zSign * (hl - CAM_FIELD_STANDOFF);
	if (zSign > 0) pos.z = Math.min(pos.z, limit);
	else pos.z = Math.max(pos.z, limit);
}

/** Target chase gdy auto w kieszeni — od razu legalny punkt, bez walki spring↔clamp. */
function enforcePocketChaseTarget(
	target: THREE.Vector3,
	carPos: THREE.Vector3,
): void {
	if (!isInsideGoalPocket(carPos, 0.55)) return;
	placePocketCamera(target, carPos);
}

function placePocketCamera(out: THREE.Vector3, carPos: THREE.Vector3): void {
	const side = whichGoalPocket(carPos, 1.2) ?? goalSideOf(carPos);
	const zSign = side === "orange" ? 1 : -1;
	const halfW = RL_ARENA.GOAL_WIDTH * 0.5;
	const limit = fieldLimitZ(side);

	out.x = THREE.MathUtils.clamp(carPos.x, -halfW + 2.2, halfW - 2.2);
	out.z = carPos.z - zSign * CAM_POCKET_BEHIND;
	if (zSign > 0) out.z = Math.min(out.z, limit);
	else out.z = Math.max(out.z, limit);
	out.y = Math.max(
		PLAYFIELD_SURFACE_Y + CAM_POCKET_MIN_Y,
		carPos.y + PLAYER_TPP.heightOffset + 0.45,
	);
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

	const angleDeg = chaseSpeedAngleDeg(_speedT, CAMERA_STIFFNESS);
	const desiredY =
		camPos.y + horiz * Math.tan(THREE.MathUtils.degToRad(angleDeg));
	lookAt.y = THREE.MathUtils.lerp(lookAt.y, desiredY, 0.12);
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
	/** Grywalny alt-rig (V) — nad Ball/Free, bez zmiany look framing. */
	rig: ChaseRigParams = CLASSIC_CHASE_RIG,
	/** 0=Free Cam, 1=Ball Cam — płynny blend przy toggle. */
	ballCamT?: number,
	/** Ściana / rampa — nie bierz heading z rzutu forward XZ. */
	onWallSurface = false,
	/** 0–1 look behind (MMB) — obraca orbitę chase o 180°. */
	lookBackT = 0,
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

	const camT = THREE.MathUtils.clamp(
		ballCamT ?? (isBallCam ? 1 : 0),
		0,
		1,
	);
	const lookBack = THREE.MathUtils.clamp(lookBackT, 0, 1);
	/** MMB/R3 — car-relative 180°, także w Ball Cam (oś piłka→auto ignoruje orbitę). */
	const lookBackPose = lookBack > 0.04 && !state.flipCamActive;
	state.ballCamFraming = tickBallCamFraming(state.ballCamFraming, camT);
	const useBallCam = state.ballCamFraming && !lookBackPose;

	_carForward.set(0, 0, 1).applyQuaternion(carQuat);
	_camDir.set(0, 1, 0).applyQuaternion(carQuat);
	const carUpY = _camDir.y;
	const airborne = !onGround && !isFlipping;
	const wallTilt = onWallSurface || carUpY < 0.62;

	/**
	 * Heading na ziemi — rzut forward + lekki damp (skręt nie telegrafuje
	 * mikro-yaw z fizyki; framing / dystans bez zmian).
	 * W powietrzu: CAŁKOWITY freeze (W/S = pitch nie może ruszyć yaw kamery).
	 * A/D air-yaw: celowo też nie kręci chase w powietrzu — RL TPP trzyma
	 * orbitę z takeoff; inaczej pitch+numeryka quat dawały „pływający” kąt.
	 * Ściana: XZ-forward przechodzi przez 0 → orbit 180° (klip wjazd).
	 */
	const horizSq =
		_carForward.x * _carForward.x + _carForward.z * _carForward.z;
	if (!isFlipping && !airborne && !wallTilt && horizSq > 0.28) {
		flatCarForward(_carForward, _flatForward);
		if (!state.initialized || state.lastFlatForward.lengthSq() < 1e-6) {
			state.lastFlatForward.copy(_flatForward);
		} else {
			smoothFlatDirToward(
				state.lastFlatForward,
				_flatForward,
				dt,
				PLAYER_TPP.headingSmoothHz,
				PLAYER_TPP.headingMaxRadPerSec,
			);
		}
	} else if (!isFlipping && !airborne && wallTilt) {
		const velH = Math.hypot(carVelocity.x, carVelocity.z);
		if (velH > 7.5) {
			_flatForward.set(carVelocity.x, 0, carVelocity.z);
			if (_flatForward.lengthSq() > 1e-6) {
				_flatForward.normalize();
				if (state.lastFlatForward.lengthSq() < 1e-6) {
					state.lastFlatForward.copy(_flatForward);
				} else {
					smoothFlatDirToward(
						state.lastFlatForward,
						_flatForward,
						dt,
						PLAYER_TPP.headingSmoothHz * 0.4,
						PLAYER_TPP.headingMaxRadPerSec * 0.28,
					);
				}
			}
		}
	}

	const wasFlipCam = state.flipCamActive;
	if (state.flipCamActive) {
		state.flipCamLockTimeS += dt;
	}

	const speedXZEarly = Math.hypot(carVelocity.x, carVelocity.z);
	const speedTEarly = THREE.MathUtils.clamp(
		speedXZEarly / RL_CAR.maxSpeed,
		0,
		1,
	);
	const stretchM = chaseSpeedStretchM(
		speedTEarly,
		chaseStiffnessForSurface(wallTilt),
	);

	if (isFlipping) {
		state.airCamActive = false;
		if (!state.flipCamActive) {
			state.flipCamActive = true;
			state.flipCamLockTimeS = 0;
			/**
			 * Orbit z AKTUALNEGO kadru — nie z nosa auta.
			 * Ball Cam / lag po skręcie: auto jest pod kątem; snap za autem
			 * centrował kadr (dodge).
			 */
			_dirToCar.set(
				carPos.x - camera.position.x,
				0,
				carPos.z - camera.position.z,
			);
			const orbitDist = Math.hypot(_dirToCar.x, _dirToCar.z);
			if (orbitDist > 0.4) {
				state.lastFlatForward.set(
					_dirToCar.x / orbitDist,
					0,
					_dirToCar.z / orbitDist,
				);
				state.flipCamDistXZ = orbitDist;
			} else if (state.lastFlatForward.lengthSq() < 1e-6) {
				carHorizontalForwardFromQuat(carQuat, state.lastFlatForward);
				state.lastFlatForward.y = 0;
				if (state.lastFlatForward.lengthSq() > 1e-6) {
					state.lastFlatForward.normalize();
				} else {
					state.lastFlatForward.set(0, 0, 1);
				}
				state.flipCamDistXZ = 0;
			} else {
				state.flipCamDistXZ = 0;
			}
			state.flipCamFov =
				state.currentHorizontalFov > 1
					? state.currentHorizontalFov
					: BASE_FOV;
			state.currentHorizontalFov = state.flipCamFov;
			camera.getWorldDirection(_camDir);
			const lookH = Math.hypot(_camDir.x, _camDir.z);
			state.flipCamPitchRad =
				lookH > 1e-4
					? Math.atan2(_camDir.y, lookH)
					: THREE.MathUtils.degToRad(CAMERA_ANGLE);
			state.flipCamHeightY = Number.isFinite(camera.position.y)
				? camera.position.y
				: carPos.y + PLAYER_TPP.heightOffset * rig.heightMul;
			state.flipCamHeightOff = state.flipCamHeightY - carPos.y;
			state.flipCamLookY = state.smoothedLookAt.y;
			state.flipCamLookOff = state.flipCamLookY - carPos.y;
			state.flipCamLookOffset.set(
				state.smoothedLookAt.x - carPos.x,
				0,
				state.smoothedLookAt.z - carPos.z,
			);
			if (state.flipCamLookOffset.lengthSq() < 0.05) {
				const ahead = PLAYER_TPP.carLookAhead * rig.lookAheadMul;
				state.flipCamLookOffset.copy(state.lastFlatForward).multiplyScalar(
					ahead,
				);
			}
			state.flipCamBallLook = camT >= 0.5;
			state.frameLookOffset.set(0, 0, 0);
			state.framePan.set(0, 0, 0);
		}
		/** Nie aktualizuj HeightY co klatkę — kąt ma zostać zamrożony. */
	} else if (state.flipCamActive) {
		/**
		 * Tylko lądowanie na kołach — in-air unlock po up.y (0.12 s)
		 * puszczał kadr w połowie sideflipa (horyzont z autem, klip 22-16).
		 */
		_camDir.set(0, 1, 0).applyQuaternion(carQuat);
		const landed =
			onGround && !isFlipping && _camDir.y > 0.72 && !wallTilt;
		if (landed || state.flipCamLockTimeS > 1.85) {
			state.flipCamActive = false;
			state.flipCamLockTimeS = 0;
		}
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
			/**
			 * Po dodge: dziedzicz zamrożony pitch flipa — nie bierz
			 * z kadru spaczonym przez floor-guard przy żółwiu.
			 */
			if (wasFlipCam) {
				state.airCamPitchRad = state.flipCamPitchRad;
			} else {
				camera.getWorldDirection(_camDir);
				const h = Math.hypot(_camDir.x, _camDir.z);
				state.airCamPitchRad =
					h > 1e-4
						? Math.atan2(_camDir.y, h)
						: THREE.MathUtils.degToRad(CAMERA_ANGLE);
			}
			state.frameLookOffset.set(0, 0, 0);
			state.framePan.set(0, 0, 0);
			/** Zachowaj pęd kamery z flipa — bez soft-reset jump. */
		}
		state.lastFlatForward.copy(state.airCamForward);
	} else if (state.airCamActive) {
		state.airCamActive = false;
	}

	const distance =
		(THREE.MathUtils.lerp(
			PLAYER_TPP.carCamDistance,
			PLAYER_TPP.ballCamDistance,
			camT,
		) +
			stretchM) *
		rig.distanceMul;

	const heightOverride = state.flipCamActive
		? state.flipCamHeightY
		: carPos.y + PLAYER_TPP.heightOffset * rig.heightMul;
	/** Ball Cam: look = piłka — nie nadpisuj Y. Free Cam: lookLiftMul. */
	const lookYOverride = state.flipCamActive
		? state.flipCamLookY
		: camT < 0.5
			? carPos.y + PLAYER_TPP.carLookLift * rig.lookLiftMul
			: undefined;

	/** Flip / air: bez predykcji z impulsu — inaczej target skacze w bok. */
	const chaseAnchor =
		state.flipCamActive || airborne
			? _predictedCar.copy(carPos)
			: predictCarPosForChase(carPos, carVelocity, boosting, _predictedCar);

	const bodyMount = isBodyMountChaseRig(rig) && !state.flipCamActive;
	const overheadMount =
		isOverheadMountChaseRig(rig) && !state.flipCamActive;

	/** Look-behind: orbit yaw +180° × lookBack (MMB), bez mutacji lastFlatForward. */
	_lookOrbit.copy(state.lastFlatForward);
	if (_lookOrbit.lengthSq() < 1e-8) _lookOrbit.set(0, 0, 1);
	else _lookOrbit.normalize();
	if (lookBack > 0.001 && !state.flipCamActive) {
		_lookOrbitQ.setFromAxisAngle(_yUp, Math.PI * lookBack);
		_lookOrbit.applyQuaternion(_lookOrbitQ);
		_lookOrbit.y = 0;
		if (_lookOrbit.lengthSq() > 1e-8) _lookOrbit.normalize();
	}

	if (overheadMount) {
		/**
		 * Top-down: prawie pionowo nad autem.
		 * Minimalny offset XZ tylko anty-gimbal; look idzie w dół (snap).
		 */
		const h = Math.max(10, rig.overheadHeight || 14);
		flatCarForward(_lookOrbit, _flatForward);
		_targetPos.set(
			chaseAnchor.x - _flatForward.x * 0.08,
			chaseAnchor.y + h,
			chaseAnchor.z - _flatForward.z * 0.08,
		);
		if (!isMeridianArenaActive()) {
			clampCameraInsideSoccar(_targetPos, chaseAnchor);
		}
	} else if (bodyMount) {
		/**
		 * Bumper / wheel / hero — flat yaw + world-up.
		 * Lokalny up z quat wpychał kamerę w murawę przy pitchu.
		 */
		flatCarForward(_lookOrbit, _carForward);
		if (_carForward.lengthSq() < 1e-6) {
			_carForward.set(0, 0, 1).applyQuaternion(carQuat);
			_carForward.y = 0;
			if (_carForward.lengthSq() > 1e-6) _carForward.normalize();
			else _carForward.set(0, 0, 1);
		}
		_camDir.set(0, 1, 0);
		_camRight.set(_carForward.z, 0, -_carForward.x);
		if (_camRight.lengthSq() > 1e-6) _camRight.normalize();
		else _camRight.set(1, 0, 0);
		_targetPos
			.copy(chaseAnchor)
			.addScaledVector(_camRight, rig.bodyRight)
			.addScaledVector(_camDir, rig.bodyUp)
			.addScaledVector(_carForward, rig.bodyForward);
		_targetPos.y = Math.max(
			_targetPos.y,
			PLAYFIELD_SURFACE_Y + 0.55,
			chaseAnchor.y + 0.35,
		);
		if (!isMeridianArenaActive()) {
			clampCameraInsideSoccar(_targetPos, chaseAnchor);
		}
	} else if (camT > 0.02 && camT < 0.98 && !isFlipping && !lookBackPose) {
		const carDist =
			(PLAYER_TPP.carCamDistance + stretchM) * rig.distanceMul;
		const ballDist =
			(PLAYER_TPP.ballCamDistance + stretchM) * rig.distanceMul;
		const ease = camT * camT * (3 - 2 * camT);
		computePlayerTppTarget(
			chaseAnchor,
			ballPos,
			_lookOrbit,
			carDist,
			false,
			heightOverride,
		);
		_framedLook.copy(_targetPos);
		computePlayerTppTarget(
			chaseAnchor,
			ballPos,
			_lookOrbit,
			ballDist,
			true,
			heightOverride,
		);
		_targetPos.copy(_framedLook).lerp(_targetPos, ease);
		/** sideRail — offset wzdłuż poziomego right. */
		if (Math.abs(rig.lateralOffset) > 1e-4 && !state.flipCamActive) {
			_camRight.set(_lookOrbit.z, 0, -_lookOrbit.x);
			if (_camRight.lengthSq() > 1e-6) {
				_camRight.normalize();
				_targetPos.addScaledVector(_camRight, rig.lateralOffset);
				clampCameraInsideSoccar(_targetPos, chaseAnchor);
				enforcePocketChaseTarget(_targetPos, chaseAnchor);
			}
		}
	} else {
		computePlayerTppTarget(
			chaseAnchor,
			ballPos,
			_lookOrbit,
			distance,
			/** Look-back: zawsze Free orbit (−forward), nie ball→car. */
			useBallCam && !isFlipping && !lookBackPose,
			heightOverride,
		);

		/** sideRail i podobne — offset wzdłuż poziomego right. */
		if (Math.abs(rig.lateralOffset) > 1e-4 && !state.flipCamActive) {
			_camRight.set(_lookOrbit.z, 0, -_lookOrbit.x);
			if (_camRight.lengthSq() > 1e-6) {
				_camRight.normalize();
				_targetPos.addScaledVector(_camRight, rig.lateralOffset);
				clampCameraInsideSoccar(_targetPos, chaseAnchor);
				enforcePocketChaseTarget(_targetPos, chaseAnchor);
			}
		}
	}

	/**
	 * Ball Cam: wygładź orbitę ball→car (target XZ). Bez tego przy gazie/skręcie
	 * oś skacze / flipuje → spring+dolly rwą kadr. PreferY / look=piłka bez zmian.
	 */
	const liveChase =
		THREE.MathUtils.clamp(countdownCamBlend, 0, 1) >= 0.99;
	let orbitLag = 0;
	if (
		camT > 0.35 &&
		!isFlipping &&
		!isMeridianArenaActive() &&
		liveChase &&
		!bodyMount &&
		!overheadMount &&
		!lookBackPose
	) {
		const savedY = _targetPos.y;
		_dirToCar.set(
			_targetPos.x - chaseAnchor.x,
			0,
			_targetPos.z - chaseAnchor.z,
		);
		if (_dirToCar.lengthSq() > 1e-6) {
			_dirToCar.normalize();
			if (!state.ballOrbitReady || state.ballOrbitDir.lengthSq() < 1e-6) {
				state.ballOrbitDir.copy(_dirToCar);
				state.ballOrbitReady = true;
			} else {
				/**
				 * Duży kąt (mijanie piłki / ostry skręt): wolniejszy orbit —
				 * framing ball-line zostaje, bez 15–20°/f sweep look.
				 * Wyjątek: zła strona (cam między auto↔piłka) — przyspiesz ucieczkę.
				 */
				const alignNow = THREE.MathUtils.clamp(
					state.ballOrbitDir.dot(_dirToCar),
					-1,
					1,
				);
				const bigArc = 1 - THREE.MathUtils.smoothstep(alignNow, 0.2, 0.85);
				const wrongSide = alignNow < 0.05;
				const maxRad =
					PLAYER_TPP.orbitMaxRadPerSec *
					(wrongSide
						? 1.45
						: THREE.MathUtils.lerp(1, 0.42, bigArc));
				const hz =
					PLAYER_TPP.orbitSmoothHz *
					(wrongSide
						? 1.35
						: THREE.MathUtils.lerp(1, 0.55, bigArc));
				smoothFlatDirToward(
					state.ballOrbitDir,
					_dirToCar,
					dt,
					hz,
					maxRad,
				);
				const align = THREE.MathUtils.clamp(
					state.ballOrbitDir.dot(_dirToCar),
					-1,
					1,
				);
				orbitLag =
					1 - THREE.MathUtils.smoothstep(align, 0.72, 0.995);
			}
			_targetPos.set(
				chaseAnchor.x + state.ballOrbitDir.x * distance,
				savedY,
				chaseAnchor.z + state.ballOrbitDir.z * distance,
			);
			clampCameraInsideSoccar(_targetPos, carPos);
		}
	} else if (camT < 0.35 || !liveChase || lookBackPose) {
		state.ballOrbitReady = false;
	}

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
	const boostFx = chaseBoostFxT(boosting, speedT);

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
	 * AIR / FLIP LOCK: zamrożony offset z klatki startu dodge + world-up.
	 * NIE snapuj za nos auta — Ball Cam / ukos zostają (klip dodge).
	 */
	if (
		(state.flipCamActive || (airborne && camT < 0.45)) &&
		!isMeridianArenaActive() &&
		!isBodyMountChaseRig(rig) &&
		!isOverheadMountChaseRig(rig)
	) {
		const fwd = state.flipCamActive
			? state.lastFlatForward
			: state.airCamForward;
		/** Flip: absolutne Y z chwili startu. Air: relative. */
		const heightY = state.flipCamActive
			? state.flipCamHeightY
			: carPos.y + PLAYER_TPP.heightOffset * rig.heightMul;
		const lockDist =
			state.flipCamActive && state.flipCamDistXZ > 0.4
				? state.flipCamDistXZ
				: distance;

		_targetPos.set(
			carPos.x - fwd.x * lockDist,
			heightY,
			carPos.z - fwd.z * lockDist,
		);
		const maxX = Math.max(4, RL_ARENA.HALF_WIDTH - 2.2);
		const maxZ = Math.max(4, RL_ARENA.HALF_LENGTH - 2.2);
		_targetPos.x = THREE.MathUtils.clamp(_targetPos.x, -maxX, maxX);
		_targetPos.z = THREE.MathUtils.clamp(_targetPos.z, -maxZ, maxZ);
		_targetPos.y = heightY;
		camera.position.copy(_targetPos);
		state.posVelocity.set(0, 0, 0);
		state.framePan.set(0, 0, 0);
		state.frameLookOffset.set(0, 0, 0);

		_clampDir.set(-fwd.x, 0, -fwd.z);
		if (_clampDir.lengthSq() > 1e-6) _clampDir.normalize();
		else _clampDir.set(0, 0, -1);
		enforceMinCameraDistXZ(
			camera.position,
			carPos,
			_clampDir,
			rig.minDistXZ,
		);
		/** Po enforceMin — przywróć zamrożone Y (XZ-only push). */
		camera.position.y = heightY;

		if (state.flipCamActive && state.flipCamBallLook) {
			_lookAt.copy(ballPos);
		} else if (state.flipCamActive) {
			_lookAt.set(
				carPos.x + state.flipCamLookOffset.x,
				state.flipCamLookY,
				carPos.z + state.flipCamLookOffset.z,
			);
		} else {
			const ahead = PLAYER_TPP.carLookAhead * rig.lookAheadMul;
			_lookAt.set(
				carPos.x + fwd.x * ahead,
				camera.position.y +
					Math.max(distance * 0.55, 0.01) *
						Math.tan(
							state.airCamPitchRad ||
								THREE.MathUtils.degToRad(CAMERA_ANGLE),
						),
				carPos.z + fwd.z * ahead,
			);
			const dx = _lookAt.x - camera.position.x;
			const dz = _lookAt.z - camera.position.z;
			const horiz = Math.max(Math.hypot(dx, dz), distance * 0.55);
			_lookAt.y =
				camera.position.y + horiz * Math.tan(state.airCamPitchRad);
		}
		state.smoothedLookAt.copy(_lookAt);
		state.initialized = true;
		applyWorldUpLook(camera, state.smoothedLookAt, fwd);
		return;
	}

	if (!state.initialized) {
		camera.position.copy(_targetPos);
		computeTppLookAt(
			carPos,
			ballPos,
			state.lastFlatForward,
			useBallCam,
			lookYOverride,
			undefined,
			Math.hypot(carVelocity.x, carVelocity.z),
		);
		/** Ball Cam: look = piłka — bez angle bias ściągającego z piłki. */
		clampLookAtPitch(camera.position, _lookAt);
		state.smoothedLookAt.copy(_lookAt);
		state.posVelocity.set(0, 0, 0);
		state.initialized = true;
	}

	let smoothTime = useBallCam
		? verticalSep > 2.5
			? PLAYER_TPP.posSmoothTimeAerial
			: PLAYER_TPP.posSmoothTimeBall
		: PLAYER_TPP.posSmoothTimeCar;
	smoothTime *= Math.max(0.12, rig.springMul);
	/**
	 * Free Cam stiffness (publiczne): 1 = sztywno za autem, 0 = lag/delay.
	 * Ball Cam: głównie stretch dystansu (już w `distance`); lekki wpływ na spring.
	 */
	{
		const stiff = THREE.MathUtils.clamp(
			chaseStiffnessForSurface(wallTilt),
			0,
			1,
		);
		if (useBallCam) {
			smoothTime *= THREE.MathUtils.lerp(1.12, 0.88, stiff);
		} else {
			smoothTime *= THREE.MathUtils.lerp(1.65, 0.72, stiff);
		}
	}
	if (isOverheadMountChaseRig(rig)) {
		smoothTime *= 0.45;
	} else if (isBodyMountChaseRig(rig)) {
		smoothTime *= 0.55;
	}
	/**
	 * Ball-cam: wolniejszy spring przy niskiej V — linia piłka↔auto obraca się
	 * przy W; ostry spring = szarpnięcie (tego nie ma free cam).
	 */
	const springT = useBallCam
		? THREE.MathUtils.smoothstep(speedT, 0.4, 0.95)
		: THREE.MathUtils.smoothstep(speedT, 0.2, 0.85);
	smoothTime *= THREE.MathUtils.lerp(
		1,
		useBallCam ? 0.65 : 0.5,
		springT * springT,
	);
	/** Ciągłe spowolnienie przy niskiej V — bez skoku przy speedT=0.3. */
	if (useBallCam) {
		const lowEase = 1 - THREE.MathUtils.smoothstep(speedT, 0.08, 0.42);
		smoothTime *= THREE.MathUtils.lerp(1, 1.2, lowEase);
		/** Orbit damp nie może zostawiać kamery w tyle (klip 07:00). */
		smoothTime *= 1 + orbitLag * 0.2;
	}
	if (boostFx > 0) smoothTime *= THREE.MathUtils.lerp(1, 0.62, boostFx);
	/** MMB look-behind: szybki swing o ~180°, nie soft chase lag. */
	if (lookBackPose) {
		smoothTime *= THREE.MathUtils.lerp(0.55, 0.16, lookBack);
	}
	let maxCamSpeed = lookBackPose
		? PLAYER_TPP.maxCameraSpeed * THREE.MathUtils.lerp(1.8, 3.2, lookBack)
		: PLAYER_TPP.maxCameraSpeed *
			THREE.MathUtils.lerp(1, useBallCam ? 1.35 : 1.7, springT) *
			(boostFx > 0 ? THREE.MathUtils.lerp(1, 1.25, boostFx) : 1);

	const distErr = camera.position.distanceTo(_targetPos);
	if (distErr > Math.sqrt(PLAYER_TPP.snapDistSq)) {
		camera.position.copy(_targetPos);
		state.posVelocity.set(0, 0, 0);
	} else {
		/** Catch-up: kamera zostaje — twardszy damp zamiast czekać na soft spring. */
		if (distErr > PLAYER_TPP.catchUpDist) {
			const catchT = THREE.MathUtils.smoothstep(
				distErr,
				PLAYER_TPP.catchUpDist,
				PLAYER_TPP.catchUpDist + 5,
			);
			smoothTime *= THREE.MathUtils.lerp(1, 0.32, catchT);
			maxCamSpeed *= THREE.MathUtils.lerp(1, 2.1, catchT);
		}
		smoothDampVec3(
			camera.position,
			_targetPos,
			state.posVelocity,
			smoothTime,
			dt,
			maxCamSpeed,
		);
	}

	/** Target height floor — bez bumper-cam po springu. */
	if (isBodyMountChaseRig(rig)) {
		camera.position.y = Math.max(
			camera.position.y,
			PLAYFIELD_SURFACE_Y + 0.55,
			carPos.y + 0.4,
		);
	} else if (isOverheadMountChaseRig(rig)) {
		/** Nie ściągaj top-down do wysokości chase — twardo trzymaj wysoko. */
		const wantY = carPos.y + Math.max(10, rig.overheadHeight || 14);
		camera.position.y = Math.max(camera.position.y, wantY * 0.92);
		/** Szybki snap XZ nad autem. */
		const dx = camera.position.x - carPos.x;
		const dz = camera.position.z - carPos.z;
		if (dx * dx + dz * dz > 2.5) {
			camera.position.x = _targetPos.x;
			camera.position.z = _targetPos.z;
			state.posVelocity.set(0, 0, 0);
		}
	} else {
		const heightFloorMul = isOverheadChaseRig(rig)
			? Math.max(1, rig.heightMul * 0.85)
			: rig.heightMul * 0.95;
		camera.position.y = Math.max(
			camera.position.y,
			_targetPos.y,
			carPos.y + PLAYER_TPP.heightOffset * heightFloorMul,
			PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y,
		);

		_clampDir.subVectors(camera.position, carPos);
		enforceMinCameraDistXZ(
			camera.position,
			carPos,
			_clampDir,
			rig.minDistXZ,
		);
	}
	if (!isMeridianArenaActive()) {
		clampCameraInsideSoccar(camera.position, carPos);
	}

	/**
	 * Ball Cam: nie podchodź lookAt (piłka) bliżej niż ~2.6 m XZ —
	 * singularity przy mijaniu = rwanie kąta mimo orbit damp.
	 */
	if (useBallCam && !state.flipCamActive && !isSpectacleChaseRig(rig)) {
		const ldx = camera.position.x - state.smoothedLookAt.x;
		const ldz = camera.position.z - state.smoothedLookAt.z;
		const lookDistXZ = Math.hypot(ldx, ldz);
		const minLook = Math.max(3.4, PLAYER_FRAME.minCamDistXZ + 0.85);
		if (lookDistXZ < minLook && lookDistXZ > 1e-5) {
			const s = minLook / lookDistXZ;
			camera.position.x = state.smoothedLookAt.x + ldx * s;
			camera.position.z = state.smoothedLookAt.z + ldz * s;
			enforceMinCameraDistXZ(
				camera.position,
				carPos,
				state.ballOrbitDir,
				rig.minDistXZ,
			);
			clampCameraInsideSoccar(camera.position, carPos);
		}
	}

	const maxBallBlend = state.flipCamActive
		? 0
		: speedXZ < 1.2
			? 0.05
			: undefined;

	if (lookBackPose) {
		/** Patrzymy w auto — widać to, co jest „za” (RL look-behind). */
		_lookAt.set(
			carPos.x,
			carPos.y + PLAYER_TPP.carLookLift * rig.lookLiftMul,
			carPos.z,
		);
	} else if (rig.lookDown && !state.flipCamActive) {
		/**
		 * Top-down: look w punkt pod / lekko przed autem na murawie.
		 * Snap — bez lerp z poprzedniego chase (inaczej zostaje horyzont).
		 */
		_lookAt.set(
			carPos.x,
			PLAYFIELD_SURFACE_Y + 0.08,
			carPos.z,
		);
		if (useBallCam) {
			/** Max 12% w stronę piłki — nadal „z góry”, nie stadium cam. */
			_framedLook.set(
				ballPos.x,
				PLAYFIELD_SURFACE_Y + 0.12,
				ballPos.z,
			);
			_lookAt.lerp(_framedLook, 0.12 * camT);
		}
		state.smoothedLookAt.copy(_lookAt);
	} else if (rig.lookAtCar && !state.flipCamActive) {
		const carLookY = carPos.y + PLAYER_TPP.carLookLift * rig.lookLiftMul;
		if (useBallCam) {
			computeTppLookAt(
				carPos,
				ballPos,
				state.lastFlatForward,
				true,
				undefined,
				maxBallBlend,
				speedXZ,
			);
			/** Hero front: 55% auto w kadrze, reszta piłka — da się grać. */
			_framedLook.set(carPos.x, carLookY, carPos.z);
			_lookAt.lerp(_framedLook, 0.55);
		} else {
			_lookAt.set(carPos.x, carLookY, carPos.z);
		}
	} else if (
		camT > 0.02 &&
		camT < 0.98 &&
		!state.flipCamActive &&
		!rig.lookDown &&
		!rig.lookAtCar
	) {
		const ease = camT * camT * (3 - 2 * camT);
		computeTppLookAt(
			carPos,
			ballPos,
			state.lastFlatForward,
			false,
			lookYOverride,
			maxBallBlend,
			speedXZ,
		);
		const ahead = PLAYER_TPP.carLookAhead * rig.lookAheadMul;
		_framedLook.set(
			carPos.x + state.lastFlatForward.x * ahead,
			lookYOverride ?? carPos.y + PLAYER_TPP.carLookLift * rig.lookLiftMul,
			carPos.z + state.lastFlatForward.z * ahead,
		);
		computeTppLookAt(
			carPos,
			ballPos,
			state.lastFlatForward,
			true,
			undefined,
			maxBallBlend,
			speedXZ,
		);
		_lookAt.copy(_framedLook).lerp(_lookAt, ease);
	} else {
		computeTppLookAt(
			carPos,
			ballPos,
			state.lastFlatForward,
			state.flipCamActive ? false : useBallCam,
			lookYOverride,
			maxBallBlend,
			speedXZ,
		);
		if (!useBallCam && !state.flipCamActive) {
			const ahead = PLAYER_TPP.carLookAhead * rig.lookAheadMul;
			_lookAt.set(
				carPos.x + state.lastFlatForward.x * ahead,
				lookYOverride ?? carPos.y + PLAYER_TPP.carLookLift * rig.lookLiftMul,
				carPos.z + state.lastFlatForward.z * ahead,
			);
		}
	}
	if (
		!isMeridianArenaActive() &&
		!state.flipCamActive &&
		camT < 0.5 &&
		!rig.lookAtCar &&
		!rig.lookDown
	) {
		_lookAt.y += PLAYER_TPP.carCamHorizonLift;
	}
	/** Ball Cam: nie ściągaj look z piłki angle-biasem. */
	if (camT < 0.5 && !state.flipCamActive && !rig.lookAtCar && !rig.lookDown) {
		applyChaseAngleBias(camera.position, _lookAt, ballPos, carPos, speedT);
	}
	if (camT < 0.5 && !rig.lookDown) {
		clampLookAtPitch(camera.position, _lookAt, rig.maxPitchDownDeg);
	}
	/** Ball Cam: szybszy look — piłka ma trzymać środek kadru (RL swivel). */
	let lookHz = state.flipCamActive
		? PLAYER_TPP.lookSmoothHz * 2.2
		: lookBackPose
			? 48
			: rig.lookDown
				? 40
				: useBallCam
					? PLAYER_TPP.lookSmoothHz *
						(1.35 + (RL_CAMERA.swivelSpeed / 6.5) * 0.45)
					: PLAYER_TPP.lookSmoothHz;
	/**
	 * Mijanie piłki / look za siebie: surowy lookAt potrafi zerwać kąt
	 * o >15°/f. Spowolnij look — nadal cel = piłka, bez zmiany framingu.
	 */
	if (
		useBallCam &&
		!state.flipCamActive &&
		!rig.lookDown &&
		state.initialized
	) {
		_camDir.copy(state.smoothedLookAt).sub(camera.position);
		_clampDir.copy(_lookAt).sub(camera.position);
		const len0 = _camDir.length();
		const len1 = _clampDir.length();
		if (len0 > 0.2 && len1 > 0.2) {
			_camDir.multiplyScalar(1 / len0);
			_clampDir.multiplyScalar(1 / len1);
			const lookAlign = THREE.MathUtils.clamp(
				_camDir.dot(_clampDir),
				-1,
				1,
			);
			const whip =
				1 - THREE.MathUtils.smoothstep(lookAlign, 0.82, 0.998);
			lookHz *= 1 - whip * 0.78;
		}
	}
	const lookAlpha = rig.lookDown ? 1 : 1 - Math.exp(-lookHz * dt);
	state.smoothedLookAt.lerp(_lookAt, lookAlpha);
	if (camT < 0.5 && !rig.lookDown) {
		clampLookAtPitch(
			camera.position,
			state.smoothedLookAt,
			rig.maxPitchDownDeg,
		);
	}

	if (isMeridianArenaActive()) {
		clampPointInsideMeridian(camera.position, 3.2);
		meridianCameraUp(carPos, _camDir);
		camera.up.copy(_camDir);
		camera.lookAt(state.smoothedLookAt);
	} else {
		clampCameraInsideSoccar(camera.position, carPos);
		applyWorldUpLook(camera, state.smoothedLookAt, state.lastFlatForward);
	}
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
	if (!isBallCam) {
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
		if (!isBallCam) {
			pose.lookAt.y += PLAYER_TPP.carCamHorizonLift;
			applyChaseAngleBias(pose.targetPos, pose.lookAt, ballPos, carPos, 0);
		}
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
	rig: ChaseRigParams = CLASSIC_CHASE_RIG,
	ballCamT?: number,
	onWallSurface = false,
	lookBackT = 0,
): void {
	const speedTForFx = THREE.MathUtils.clamp(
		(speedXZ > 0 ? speedXZ : speed) / RL_CAR.maxSpeed,
		0,
		1,
	);
	const boostFx = chaseBoostFxT(boosting, speedTForFx);
	const camT = THREE.MathUtils.clamp(
		ballCamT ?? (isBallCam ? 1 : 0),
		0,
		1,
	);

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
		rig,
		camT,
		onWallSurface,
		lookBackT,
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
		} else if (state.flipCamActive || (!onGround && camT < 0.45)) {
			/**
			 * Flip / Free Cam air lock: zero framingu.
			 * Flip: NIE nadpisuj Y (absolutne z startu dodge).
			 */
			state.frameLookOffset.set(0, 0, 0);
			state.framePan.set(0, 0, 0);
			if (!state.flipCamActive) {
				camera.position.y = Math.max(
					camera.position.y,
					carPos.y + PLAYER_TPP.heightOffset,
					PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y,
				);
			} else {
				camera.position.y = state.flipCamHeightY;
			}
			camera.up.set(0, 1, 0);
			camera.lookAt(state.smoothedLookAt);
		} else if (isSpectacleChaseRig(rig)) {
			/** Top-down / body mounts: bez preferY dolly / floor-guard. */
			state.frameLookOffset.set(0, 0, 0);
			state.framePan.set(0, 0, 0);
			if (
				!isBodyMountChaseRig(rig) &&
				!isOverheadMountChaseRig(rig)
			) {
				_clampDir
					.copy(state.lastFlatForward)
					.setY(0)
					.multiplyScalar(-1);
				if (_clampDir.lengthSq() > 1e-6) _clampDir.normalize();
				else _clampDir.set(0, 0, -1);
				enforceMinCameraDistXZ(
					camera.position,
					carPos,
					_clampDir,
					rig.minDistXZ,
				);
			}
			clampCameraInsideSoccar(camera.position, carPos);
			camera.up.set(0, 1, 0);
			camera.lookAt(state.smoothedLookAt);
		} else if (state.ballCamFraming) {
			/**
			 * Ball Cam (spec Pana Kamila): look = piłka (środek kadru).
			 * Auto u dołu — miękki dolly pozycji (1 krok, rate-limit).
			 */
			state.frameLookOffset.set(0, 0, 0);
			state.framePan.set(0, 0, 0);
			camera.up.set(0, 1, 0);
			camera.lookAt(state.smoothedLookAt);
			clampCameraInsideSoccar(camera.position, carPos);

			const inPocket = isInsideGoalPocket(carPos, 0.55);
			const camInPocket =
				isInsideGoalPocket(camera.position, 0.25) ||
				isPastGoalLine(camera.position);
			const nearGoal =
				Math.abs(carPos.z) > RL_ARENA.HALF_LENGTH - 8;
			/** Pocket / uste: zero dolly — finalize daje hard pose. */
			if (inPocket || camInPocket) {
				placePocketCamera(camera.position, carPos);
				camera.up.set(0, 1, 0);
				camera.lookAt(state.smoothedLookAt);
			} else {
			const preferY = THREE.MathUtils.lerp(
				PLAYER_FRAME.preferY,
				PLAYER_FRAME.preferYBoosting,
				boostFx,
			);
			camera.updateMatrixWorld(true);
			_ndc.copy(carPos).project(camera);
			const ndcOk =
				Number.isFinite(_ndc.x) &&
				_ndc.z > -0.15 &&
				_ndc.z < 1.08 &&
				Math.abs(_ndc.x) < 1.25 &&
				Math.abs(_ndc.y) < 1.25;
			if (ndcOk) {
				const errY = preferY - _ndc.y;
				const errX = -_ndc.x;
				const offFrame =
					Math.abs(_ndc.x) > 0.72 ||
					_ndc.y < -0.92 ||
					_ndc.y > 0.15;
				if (Math.abs(errY) >= 0.035 || Math.abs(errX) >= 0.055 || offFrame) {
					_clampDir.subVectors(camera.position, carPos);
					_clampDir.y = 0;
					if (_clampDir.lengthSq() < 1e-4) {
						flatCarForward(state.lastFlatForward, _clampDir);
						_clampDir.multiplyScalar(-1);
					} else {
						_clampDir.normalize();
					}
					_camRight.set(_clampDir.z, 0, -_clampDir.x);
					if (_camRight.lengthSq() > 1e-6) {
						_camRight.normalize();
					} else {
						_camRight.set(1, 0, 0);
					}
					const soft = 1 - Math.exp(-PLAYER_TPP.dollySoftHz * dt);
					const urgency = offFrame ? 2.4 : 1;
					const maxStep = PLAYER_TPP.dollyMaxStepM * soft * urgency;
					if (Math.abs(errY) >= 0.035 || offFrame) {
						const step = THREE.MathUtils.clamp(
							errY * 0.9 * soft * urgency,
							-maxStep,
							maxStep,
						);
						/**
						 * Blisko bramki: tylko odsuwaj / podnoś — nigdy nie ciągnij
						 * w stronę ust (wyższy |z|).
						 */
						const towardMouth =
							Math.sign(carPos.z || 1) *
								(camera.position.z + _clampDir.z * step) >
							Math.abs(camera.position.z);
						if (!nearGoal || step >= 0 || !towardMouth) {
							camera.position.addScaledVector(_clampDir, step);
						}
					}
					if (Math.abs(errX) >= 0.055 || offFrame) {
						camera.position.addScaledVector(
							_camRight,
							THREE.MathUtils.clamp(
								errX * 0.75 * soft * urgency,
								-maxStep * 0.85,
								maxStep * 0.85,
							),
						);
					}
					camera.position.y = Math.max(
						camera.position.y,
						carPos.y + PLAYER_TPP.heightOffset * 0.95,
						PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y,
					);
					enforceMinCameraDistXZ(camera.position, carPos, _clampDir);
					clampCameraInsideSoccar(camera.position, carPos);
					camera.up.set(0, 1, 0);
					camera.lookAt(state.smoothedLookAt);
				}
			} else {
				/** Auto poza projection — twardy dolly za autem względem piłki. */
				_clampDir.subVectors(camera.position, carPos);
				_clampDir.y = 0;
				if (_clampDir.lengthSq() < 1e-4) {
					flatCarForward(state.lastFlatForward, _clampDir);
					_clampDir.multiplyScalar(-1);
				} else {
					_clampDir.normalize();
				}
				const dist = Math.hypot(
					camera.position.x - carPos.x,
					camera.position.z - carPos.z,
				);
				const want = Math.max(dist, PLAYER_FRAME.minCamDistXZ + 0.4);
				camera.position.x = carPos.x + _clampDir.x * want;
				camera.position.z = carPos.z + _clampDir.z * want;
				camera.position.y = Math.max(
					camera.position.y,
					carPos.y + PLAYER_TPP.heightOffset,
					PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y,
				);
				clampCameraInsideSoccar(camera.position, carPos);
				camera.up.set(0, 1, 0);
				camera.lookAt(state.smoothedLookAt);
			}
			}
		} else {
			const preferY = THREE.MathUtils.lerp(
				PLAYER_FRAME.preferY,
				PLAYER_FRAME.preferYBoosting,
				boostFx,
			);
			const inPocket = isInsideGoalPocket(carPos, 0.55);
			const camInPocket =
				isInsideGoalPocket(camera.position, 0.25) ||
				isPastGoalLine(camera.position);
			if (inPocket || camInPocket) {
				placePocketCamera(camera.position, carPos);
				state.frameLookOffset.set(0, 0, 0);
				state.framePan.set(0, 0, 0);
				_framedLook.set(
					carPos.x,
					Math.max(carPos.y + 0.5, PLAYFIELD_SURFACE_Y + 0.85),
					carPos.z,
				);
				state.smoothedLookAt.copy(_framedLook);
				camera.up.set(0, 1, 0);
				camera.lookAt(_framedLook);
			} else {
				/** Free Cam: framing lookAt OK — auto u dołu, look = przód. */
				applyPlayerScreenFraming(
					camera,
					carPos,
					state,
					dt,
					speedXZ,
					preferY,
				);
				clampCameraInsideSoccar(camera.position, carPos);

				camera.updateMatrixWorld(true);
				_ndc.copy(carPos).project(camera);
				const floorGuard =
					PLAYER_FRAME.floorGuardY + 0.06 * boostFx;
				const allowFloor = boostFx > 0 || _ndc.y < floorGuard - 0.08;
				const nearGoal = Math.abs(carPos.z) > RL_ARENA.HALF_LENGTH - 8;
				if (
					allowFloor &&
					(_ndc.y < floorGuard || (boostFx > 0 && _ndc.y < -0.58))
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
						const step = Math.min(err * 1.6, boostFx > 0 ? 0.16 : 0.2);
						if (!nearGoal || step >= 0) {
							camera.position.addScaledVector(_clampDir, step);
						}
						camera.position.y = Math.max(
							camera.position.y,
							carPos.y + PLAYER_TPP.heightOffset * 0.95,
							PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y,
						);
						enforceMinCameraDistXZ(camera.position, carPos, _clampDir);
						clampCameraInsideSoccar(camera.position, carPos);
						camera.up.set(0, 1, 0);
						camera.lookAt(
							_framedLook
								.copy(state.smoothedLookAt)
								.add(state.frameLookOffset),
						);
					}
				}
				clampLookAtPitch(
					camera.position,
					state.smoothedLookAt,
					rig.maxPitchDownDeg,
				);
				camera.up.set(0, 1, 0);
				camera.lookAt(
					_framedLook.copy(state.smoothedLookAt).add(state.frameLookOffset),
				);
				clampLookAtPitch(
					camera.position,
					_framedLook,
					rig.maxPitchDownDeg,
				);
				camera.lookAt(_framedLook);
			}
		}
	}

	if (state.shakeIntensity > 0.001) {
		state.shakeIntensity *= 0.04 ** dt;
		const s = state.shakeIntensity;
		state.shakeApplied.set(
			(Math.random() - 0.5) * s * 0.045,
			(Math.random() - 0.5) * s * 0.028,
			(Math.random() - 0.5) * s * 0.045,
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
	/** Boost bez prędkości = tylko FOV/spring szarpie auto w kadrze (klip 17-09). */
	const boostT = boostFx * 0.35;
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
	/** Airborne / flip: stały FOV bazowy — bez punchu (wygląda jak zmiana rzutu). */
	const targetHFov = clampChaseRigFov(
		state.flipCamActive || !onGround
			? state.flipCamActive
				? state.flipCamFov > 1
					? state.flipCamFov
					: baseHorizontalFov
				: baseHorizontalFov
			: THREE.MathUtils.lerp(
					baseHorizontalFov,
					MAX_HORIZONTAL_FOV,
					Math.max(
						/** Pro stiffness 0.35: czytelny FOV punch przy SS (nie przy idle W). */
						fovSpeedT * 0.28,
						/** Boost nie rozszerza FOV gdy auto już nisko — ucinało z dołu. */
						boostT * (lowInFrame ? 0.04 : 0.38),
					),
				) +
					goalFovBoost +
					meridianFov +
					rig.fovAddDeg,
	);
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

	/**
	 * Kontrakt: midfield vs pocket — jeden egzekutor na koniec klatki.
	 * Podczas dodge / Free Cam air: NIE podbijaj Y gdy auto na dachu —
	 * to zmieniało kąt patrzenia w środku flipa.
	 */
	const freeAirLock =
		state.flipCamActive || (!onGround && camT < 0.45);
	if (!freeAirLock) {
		_camDir.set(0, 1, 0).applyQuaternion(carQuat);
		if (_camDir.y < -0.2 && !isMeridianArenaActive()) {
			camera.up.set(0, 1, 0);
			camera.position.y = Math.max(
				camera.position.y,
				PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y + 0.6,
			);
			state.posVelocity.set(0, 0, 0);
			state.frameLookOffset.set(0, 0, 0);
		}
	}
	finalizeSoccarCamera(camera, carPos, state, {
		preserveSpectacleHeight: isSpectacleChaseRig(rig) || freeAirLock,
		bodyMount: isBodyMountChaseRig(rig),
		overhead: isOverheadMountChaseRig(rig),
		airLock: freeAirLock,
	});
	if (freeAirLock) {
		if (state.flipCamActive) {
			camera.position.y = state.flipCamHeightY;
		} else {
			camera.position.y = Math.max(
				camera.position.y,
				carPos.y + PLAYER_TPP.heightOffset,
				PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y,
			);
		}
	}
	if (!isMeridianArenaActive()) {
		applyWorldUpLook(
			camera,
			state.smoothedLookAt,
			state.lastFlatForward,
		);
	}
}

/**
 * Egzekutor kontraktu kamery (midfield AABB / pocket hard pose).
 * Wywoływane raz na końcu chase oraz po snap/rescue.
 */
export function finalizeSoccarCamera(
	camera: THREE.PerspectiveCamera,
	carPos: THREE.Vector3,
	state?: ChaseCameraState,
	opts?: {
		preserveSpectacleHeight?: boolean;
		bodyMount?: boolean;
		overhead?: boolean;
		/** Dodge / Free Cam air — bez pocket teleport / agresywnego clamp Y. */
		airLock?: boolean;
	},
): void {
	if (isMeridianArenaActive()) return;
	camera.up.set(0, 1, 0);

	if (opts?.airLock) {
		if (state?.flipCamActive) {
			camera.position.y = state.flipCamHeightY;
		} else {
			camera.position.y = Math.max(
				camera.position.y,
				carPos.y + PLAYER_TPP.heightOffset * 0.95,
				PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y,
			);
		}
		const maxX = Math.max(4, RL_ARENA.HALF_WIDTH - 2.2);
		const maxZ = Math.max(4, RL_ARENA.HALF_LENGTH - 2.2);
		camera.position.x = THREE.MathUtils.clamp(camera.position.x, -maxX, maxX);
		camera.position.z = THREE.MathUtils.clamp(camera.position.z, -maxZ, maxZ);
		camera.up.set(0, 1, 0);
		return;
	}

	const inPocket = isInsideGoalPocket(carPos, 0.55);
	const camBad =
		isInsideGoalPocket(camera.position, 0.25) ||
		isPastGoalLine(camera.position);

	if (inPocket || camBad) {
		placePocketCamera(camera.position, carPos);
		const look = state?.smoothedLookAt ?? _lookAt;
		look.set(
			carPos.x,
			Math.max(carPos.y + 0.5, PLAYFIELD_SURFACE_Y + 0.85),
			carPos.z,
		);
		if (state) {
			state.smoothedLookAt.copy(look);
			state.posVelocity.set(0, 0, 0);
			state.frameLookOffset.set(0, 0, 0);
			state.framePan.set(0, 0, 0);
		}
		camera.up.set(0, 1, 0);
		camera.lookAt(look);
		return;
	}

	if (opts?.overhead) {
		/** Top-down: nie ściągaj do wysokości chase. */
		camera.position.y = Math.max(
			camera.position.y,
			carPos.y + 6,
			PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y,
		);
	} else if (opts?.bodyMount) {
		/** Bumper/wheel: niski keep-out, nie wymuszaj TPP height. */
		camera.position.y = Math.max(
			camera.position.y,
			PLAYFIELD_SURFACE_Y + 0.55,
			carPos.y + 0.4,
		);
	} else if (!opts?.preserveSpectacleHeight) {
		camera.position.y = Math.max(
			camera.position.y,
			PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y,
			carPos.y + PLAYER_TPP.heightOffset * 0.95,
		);
	} else {
		camera.position.y = Math.max(
			camera.position.y,
			PLAYFIELD_SURFACE_Y + CAM_MID_MIN_Y,
		);
	}
	clampCameraInsideSoccar(camera.position, carPos);
	camera.up.set(0, 1, 0);
}
