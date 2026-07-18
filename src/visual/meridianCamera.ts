import * as THREE from "three";

import { getMeridianSphere } from "./meridianArena";

const _n = new THREE.Vector3();
const _back = new THREE.Vector3();
const _side = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _toBall = new THREE.Vector3();
const _carLook = new THREE.Vector3();

/**
 * Meridian ball cam — auto w centrum, piłka na osi widzenia.
 * Dystans większy niż standard TPP, żeby auto i piłka mieściły się w kadrze.
 */
export const MERIDIAN_CAM = {
	ballDistance: 15.5,
	carDistance: 13.2,
	/** Lift w stronę środka sfery (od ściany). */
	inwardLift: 3.6,
	lookInward: 0.55,
	/**
	 * Look-at na stałą odległość w kierunku piłki od auta —
	 * auto zostaje w centrum, piłka dalej na tym samym promieniu.
	 */
	lookAhead: 24,
	/** Zapas od skorupy — kamera nigdy nie wychodzi na zewnątrz. */
	shellClearance: 5.2,
	minCenterClearance: 5.5,
	/** FOV boost (horizontal deg) względem BASE_FOV. */
	fovBoost: 14,
} as const;

/**
 * Cel pozycji kamery Meridian — zawsze wewnątrz sfery,
 * za autem na stycznej (oś widoku = auto→piłka).
 */
export function computeMeridianCamTarget(
	carPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	carForward: THREE.Vector3,
	isBallCam: boolean,
	out: THREE.Vector3,
): THREE.Vector3 {
	const sphere = getMeridianSphere();
	if (!sphere) {
		out.copy(carPos);
		return out;
	}

	_n.copy(sphere.center).sub(carPos);
	if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0);
	else _n.normalize();

	if (isBallCam) {
		_toBall.subVectors(ballPos, carPos);
		const ballSep = _toBall.length();
		_back.copy(_toBall).multiplyScalar(-1);
		_tmp.copy(_n).multiplyScalar(_back.dot(_n));
		_back.sub(_tmp);
		if (_back.lengthSq() < 0.08) {
			_back.copy(carForward).multiplyScalar(-1);
			_tmp.copy(_n).multiplyScalar(_back.dot(_n));
			_back.sub(_tmp);
		}
		if (_back.lengthSq() < 1e-8) {
			_side.set(1, 0, 0);
			if (Math.abs(_n.dot(_side)) > 0.9) _side.set(0, 0, 1);
			_back.crossVectors(_n, _side);
		}
		_back.normalize();
		/** Dalej gdy piłka daleko — więcej miejsca w kadrze. */
		const dist =
			MERIDIAN_CAM.ballDistance +
			THREE.MathUtils.clamp((ballSep - 8) * 0.22, 0, 6);
		out
			.copy(carPos)
			.addScaledVector(_back, dist)
			.addScaledVector(_n, MERIDIAN_CAM.inwardLift);
		clampPointInsideMeridian(out, MERIDIAN_CAM.shellClearance);
		return out;
	}

	_back.copy(carForward).multiplyScalar(-1);
	_tmp.copy(_n).multiplyScalar(_back.dot(_n));
	_back.sub(_tmp);

	if (_back.lengthSq() < 1e-8) {
		_side.set(1, 0, 0);
		if (Math.abs(_n.dot(_side)) > 0.9) _side.set(0, 0, 1);
		_back.crossVectors(_n, _side);
	}
	_back.normalize();

	out
		.copy(carPos)
		.addScaledVector(_back, MERIDIAN_CAM.carDistance)
		.addScaledVector(_n, MERIDIAN_CAM.inwardLift);

	clampPointInsideMeridian(out, MERIDIAN_CAM.shellClearance);
	return out;
}

/**
 * Look-at: przez auto w stronę piłki —
 * auto w centrum, piłka na osi (nie z boku kadru).
 */
export function computeMeridianCamLookAt(
	carPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	carForward: THREE.Vector3,
	isBallCam: boolean,
	out: THREE.Vector3,
): THREE.Vector3 {
	const sphere = getMeridianSphere();
	if (!sphere) {
		out.copy(isBallCam ? ballPos : carPos);
		return out;
	}

	_n.copy(sphere.center).sub(carPos);
	if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0);
	else _n.normalize();

	_carLook.copy(carPos).addScaledVector(_n, MERIDIAN_CAM.lookInward);

	if (!isBallCam) {
		_back.copy(carForward);
		_tmp.copy(_n).multiplyScalar(_back.dot(_n));
		_back.sub(_tmp);
		if (_back.lengthSq() < 1e-8) {
			out.copy(_carLook);
			return out;
		}
		_back.normalize();
		out.copy(_carLook).addScaledVector(_back, MERIDIAN_CAM.lookAhead);
		return out;
	}

	_toBall.subVectors(ballPos, carPos);
	const sep = _toBall.length();
	if (sep < 0.5) {
		_back.copy(carForward);
		_tmp.copy(_n).multiplyScalar(_back.dot(_n));
		_back.sub(_tmp);
		if (_back.lengthSq() < 1e-8) {
			out.copy(_carLook);
			return out;
		}
		_back.normalize();
		out.copy(_carLook).addScaledVector(_back, MERIDIAN_CAM.lookAhead);
		return out;
	}
	_toBall.multiplyScalar(1 / sep);
	/** Look trochę przed piłką gdy blisko, dalej gdy piłka daleko — auto zostaje centralnie. */
	const ahead = THREE.MathUtils.clamp(
		sep * 0.55,
		MERIDIAN_CAM.lookAhead * 0.55,
		MERIDIAN_CAM.lookAhead * 1.35,
	);
	out.copy(_carLook).addScaledVector(_toBall, ahead);
	return out;
}

/** „Góra” kamery = normalna powierzchni (do środka) — stabilne na ścianie/suficie. */
export function meridianCameraUp(
	carPos: THREE.Vector3,
	out: THREE.Vector3,
): THREE.Vector3 {
	const sphere = getMeridianSphere();
	if (!sphere) {
		out.set(0, 1, 0);
		return out;
	}
	out.copy(sphere.center).sub(carPos);
	if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
	else out.normalize();
	return out;
}

/** Wciska punkt do wnętrza sfery z zapasem od skorupy. */
export function clampPointInsideMeridian(
	p: THREE.Vector3,
	clearance: number,
): void {
	const sphere = getMeridianSphere();
	if (!sphere) return;
	const maxR = Math.max(
		MERIDIAN_CAM.minCenterClearance,
		sphere.radius - clearance,
	);
	_tmp.copy(p).sub(sphere.center);
	const d = _tmp.length();
	if (d < 1e-6) {
		p.copy(sphere.center).addScaledVector(new THREE.Vector3(0, -1, 0), maxR * 0.5);
		return;
	}
	if (d > maxR) {
		_tmp.multiplyScalar(maxR / d);
		p.copy(sphere.center).add(_tmp);
	}
}
