/**
 * Jumbotron LIVE — okresowy feed boiska jak transmisja sportowa.
 * Jeden RT na wszystkie skrzydła; cięcia kamer co kilka sekund.
 *
 * Zakazane: zza bramki / goal-line / nisko pod poprzeczką — na ekranie nic nie widać.
 * Tylko wysokie ujęcia z bandy / press box / ¾ z boku.
 */
import * as THREE from "three";

import { ArenaRuntime } from "../arena/ArenaRuntime";
import {
	getJumbotronScreenMeshes,
	setJumbotronLiveMap,
} from "./goalBackboardVisual";

export type BroadcastShotId =
	| "highWide"
	| "sideline"
	| "pressBox"
	| "elevatedFollow"
	| "tactical"
	| "cornerHigh"
	| "teleBall"
	| "oppositeRail";

/** Kolejność cięć — czytelne ujęcia TV (bez endzone / goal-line). */
export const BROADCAST_SHOT_ORDER: readonly BroadcastShotId[] = [
	"highWide",
	"sideline",
	"teleBall",
	"pressBox",
	"tactical",
	"elevatedFollow",
	"cornerHigh",
	"oppositeRail",
] as const;

export const BROADCAST_SHOT_MS = [3_800, 5_800] as const;
export const BROADCAST_RT = { w: 512, h: 288 } as const;

/** Min. wysokość oka — powyżej poprzeczki / dachów geometrii bramki. */
const MIN_EYE_Y = 9.5;
/** Oko nigdy bliżej linii bramkowej niż to (od środka boiska). */
const MAX_END_FRAC = 0.72;

const _ball = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _look = new THREE.Vector3();
const _eyeSm = new THREE.Vector3();
const _lookSm = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

let active = false;
let rt: THREE.WebGLRenderTarget | null = null;
let cam: THREE.PerspectiveCamera | null = null;
let shotIdx = 0;
let shotT = 0;
let shotDur = 4.5;
let sideSign: 1 | -1 = 1;
let cutBoost = 0;
let primed = false;

function halfExtents(): { halfW: number; halfL: number } {
	const d = ArenaRuntime.get().dimensions;
	return { halfW: d.width * 0.5, halfL: d.length * 0.5 };
}

function randBetween(lo: number, hi: number): number {
	return lo + Math.random() * (hi - lo);
}

function clampEye(
	outEye: THREE.Vector3,
	halfW: number,
	halfL: number,
): void {
	outEye.y = Math.max(MIN_EYE_Y, outEye.y);
	const maxZ = halfL * MAX_END_FRAC;
	outEye.z = THREE.MathUtils.clamp(outEye.z, -maxZ, maxZ);
	/** Oko z zewnątrz bandy X — nie w środku ściany / bramki. */
	const minAbsX = halfW + 2.5;
	if (Math.abs(outEye.x) < minAbsX) {
		outEye.x = Math.sign(outEye.x || 1) * minAbsX;
	}
}

/** Pozycja oka / lookAt — fokus na piłkę, zawsze czytelny kadr boiska. */
export function sampleBroadcastShot(
	id: BroadcastShotId,
	ball: THREE.Vector3,
	halfW: number,
	halfL: number,
	railSign: 1 | -1,
	outEye: THREE.Vector3,
	outLook: THREE.Vector3,
): number {
	const bx = THREE.MathUtils.clamp(ball.x, -halfW + 2, halfW - 2);
	const bz = THREE.MathUtils.clamp(ball.z, -halfL + 2, halfL - 2);
	const by = Math.max(0.4, ball.y);
	outLook.set(bx * 0.55, Math.min(by, 4) * 0.45 + 1.1, bz * 0.75);

	switch (id) {
		case "highWide": {
			outEye.set(
				railSign * (halfW + 14),
				18,
				THREE.MathUtils.clamp(bz * 0.35, -halfL * 0.4, halfL * 0.4),
			);
			outLook.set(bx * 0.15, 1.4, bz * 0.55);
			clampEye(outEye, halfW, halfL);
			return 50;
		}
		case "sideline": {
			outEye.set(
				railSign * (halfW + 5.5),
				11.5,
				THREE.MathUtils.clamp(bz * 0.85, -halfL * 0.55, halfL * 0.55),
			);
			outLook.set(bx * 0.7, by * 0.45 + 1.0, bz);
			clampEye(outEye, halfW, halfL);
			return 54;
		}
		case "pressBox": {
			/** Wysoka banda przy środku — klasyczny press box. */
			outEye.set(railSign * (halfW + 8), 16.5, bz * 0.2);
			outLook.set(bx * 0.35, 1.2, bz * 0.7);
			clampEye(outEye, halfW, halfL);
			return 48;
		}
		case "elevatedFollow": {
			/** ¾ z boku nad grą — nie zza bramki. */
			outEye.set(
				railSign * (halfW + 7),
				13.5,
				THREE.MathUtils.clamp(bz * 0.55 - railSign * 2, -halfL * 0.5, halfL * 0.5),
			);
			outLook.set(bx * 0.55, by * 0.4 + 1.0, bz * 0.85);
			clampEye(outEye, halfW, halfL);
			return 52;
		}
		case "tactical": {
			outEye.set(bx * 0.1, 32, bz * 0.15 - 2);
			outLook.set(bx * 0.35, 0.3, bz * 0.5);
			outEye.y = Math.max(MIN_EYE_Y, outEye.y);
			outEye.z = THREE.MathUtils.clamp(outEye.z, -halfL * 0.55, halfL * 0.55);
			return 46;
		}
		case "cornerHigh": {
			const cz = Math.sign(bz || 1) * halfL * 0.55;
			outEye.set(railSign * (halfW + 6), 14, cz);
			outLook.set(bx * 0.45, 1.2, bz * 0.55);
			clampEye(outEye, halfW, halfL);
			return 52;
		}
		case "teleBall": {
			outEye.set(
				railSign * (halfW + 7),
				12.5,
				THREE.MathUtils.clamp(bz * 0.7 - railSign * 6, -halfL * 0.5, halfL * 0.5),
			);
			outLook.set(bx, by * 0.55 + 0.8, bz);
			clampEye(outEye, halfW, halfL);
			return 38;
		}
		case "oppositeRail": {
			const opp = (railSign * -1) as 1 | -1;
			outEye.set(
				opp * (halfW + 9),
				15,
				THREE.MathUtils.clamp(bz * 0.4, -halfL * 0.45, halfL * 0.45),
			);
			outLook.set(bx * 0.4, 1.3, bz * 0.65);
			clampEye(outEye, halfW, halfL);
			return 50;
		}
		default: {
			outEye.set(railSign * (halfW + 10), 14, 0);
			outLook.set(0, 1.2, 0);
			clampEye(outEye, halfW, halfL);
			return 52;
		}
	}
}

function ensureRt(): void {
	if (rt && cam) return;
	rt = new THREE.WebGLRenderTarget(BROADCAST_RT.w, BROADCAST_RT.h, {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		format: THREE.RGBAFormat,
		type: THREE.UnsignedByteType,
		colorSpace: THREE.SRGBColorSpace,
		depthBuffer: true,
		stencilBuffer: false,
	});
	rt.texture.generateMipmaps = false;
	cam = new THREE.PerspectiveCamera(
		52,
		BROADCAST_RT.w / BROADCAST_RT.h,
		0.8,
		260,
	);
	cam.name = "jumbotronBroadcastCam";
}

function applyCurrentShot(hard: boolean): void {
	const { halfW, halfL } = halfExtents();
	const id = BROADCAST_SHOT_ORDER[shotIdx]!;
	const fov = sampleBroadcastShot(
		id,
		_ball,
		halfW,
		halfL,
		sideSign,
		_eye,
		_look,
	);
	if (cam) {
		cam.fov = fov;
		cam.updateProjectionMatrix();
	}
	if (hard || !primed) {
		_eyeSm.copy(_eye);
		_lookSm.copy(_look);
		primed = true;
	} else {
		cutBoost = 0.55;
	}
}

function advanceShot(hard: boolean): void {
	shotIdx = (shotIdx + 1) % BROADCAST_SHOT_ORDER.length;
	sideSign = Math.random() < 0.5 ? 1 : -1;
	shotT = 0;
	shotDur = randBetween(BROADCAST_SHOT_MS[0], BROADCAST_SHOT_MS[1]) / 1000;
	applyCurrentShot(hard);
}

export function isJumbotronBroadcastActive(): boolean {
	return active;
}

export function setJumbotronBroadcastActive(on: boolean): void {
	if (on === active) {
		if (on && rt) setJumbotronLiveMap(rt.texture);
		return;
	}
	active = on;
	if (on) {
		ensureRt();
		shotIdx = Math.floor(Math.random() * BROADCAST_SHOT_ORDER.length);
		sideSign = Math.random() < 0.5 ? 1 : -1;
		shotT = 0;
		shotDur = randBetween(BROADCAST_SHOT_MS[0], BROADCAST_SHOT_MS[1]) / 1000;
		primed = false;
		applyCurrentShot(true);
		if (rt) setJumbotronLiveMap(rt.texture);
	} else {
		setJumbotronLiveMap(null);
		cutBoost = 0;
	}
}

export function updateJumbotronBroadcast(
	dt: number,
	ballPos: THREE.Vector3,
): void {
	if (!active || !cam) return;
	_ball.copy(ballPos);
	shotT += dt;
	if (shotT >= shotDur) advanceShot(false);
	else applyCurrentShot(false);

	const follow = cutBoost > 0 ? 10 : 3.2;
	if (cutBoost > 0) cutBoost = Math.max(0, cutBoost - dt);
	const a = 1 - Math.exp(-follow * dt);
	_eyeSm.lerp(_eye, a);
	_lookSm.lerp(_look, a);
	cam.position.copy(_eyeSm);
	cam.up.copy(_up);
	cam.lookAt(_lookSm);
	cam.updateMatrixWorld(true);
}

/**
 * Offscreen render przed głównym passem meczu.
 * Ukrywa mesh jumbotronów — bez feedbacku tekstury w teksturę.
 */
export function renderJumbotronBroadcast(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
): void {
	if (!active || !rt || !cam) return;

	const meshes = getJumbotronScreenMeshes();
	const prevVis: boolean[] = [];
	for (let i = 0; i < meshes.length; i++) {
		prevVis[i] = meshes[i]!.visible;
		meshes[i]!.visible = false;
	}

	const prevTone = renderer.toneMapping;
	const prevExp = renderer.toneMappingExposure;
	const prevTarget = renderer.getRenderTarget();
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = Math.min(prevExp || 1, 1.05);
	renderer.setRenderTarget(rt);
	renderer.clear(true, true, true);
	renderer.render(scene, cam);
	renderer.setRenderTarget(prevTarget);
	renderer.toneMapping = prevTone;
	renderer.toneMappingExposure = prevExp;

	for (let i = 0; i < meshes.length; i++) {
		meshes[i]!.visible = prevVis[i]!;
	}
}

export function disposeJumbotronBroadcast(): void {
	active = false;
	setJumbotronLiveMap(null);
	rt?.dispose();
	rt = null;
	cam = null;
	primed = false;
	cutBoost = 0;
	shotT = 0;
}
