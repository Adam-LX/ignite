/**
 * Grywalne rigi chase — V cyklem (nad Ball Cam / Free Cam).
 * chase = TPP · body = na aucie · overhead = prawdziwy widok z góry.
 */

export type ChaseRigId =
	| "classic"
	| "lowBoom"
	| "bumper"
	| "wheel"
	| "sideRail"
	| "telephoto"
	| "heroFront"
	| "highWide"
	| "topDown";

export type ChaseRigLabelKey =
	| "hud.cam.classic"
	| "hud.cam.lowBoom"
	| "hud.cam.bumper"
	| "hud.cam.wheel"
	| "hud.cam.sideRail"
	| "hud.cam.telephoto"
	| "hud.cam.heroFront"
	| "hud.cam.highWide"
	| "hud.cam.topDown";

export type ChaseRigMount = "chase" | "body" | "overhead";

export type ChaseRigPreset = {
	id: ChaseRigId;
	labelKey: ChaseRigLabelKey;
	mount: ChaseRigMount;
	distanceMul: number;
	heightMul: number;
	/** FOV Δ — ujemne = zoom / tele. */
	fovAddDeg: number;
	lateralOffset: number;
	lookLiftMul: number;
	minDistXZ: number;
	maxPitchDownDeg: number;
	bodyRight: number;
	bodyUp: number;
	bodyForward: number;
	/** Overhead: wysokość nad autem (m). */
	overheadHeight: number;
	springMul: number;
	lookAheadMul: number;
	/** Look na auto (hero / top-down). */
	lookAtCar: boolean;
	/** Patrzenie w dół na murawę pod autem (top-down). */
	lookDown: boolean;
};

export type ChaseRigParams = Pick<
	ChaseRigPreset,
	| "mount"
	| "distanceMul"
	| "heightMul"
	| "fovAddDeg"
	| "lateralOffset"
	| "lookLiftMul"
	| "minDistXZ"
	| "maxPitchDownDeg"
	| "bodyRight"
	| "bodyUp"
	| "bodyForward"
	| "overheadHeight"
	| "springMul"
	| "lookAheadMul"
	| "lookAtCar"
	| "lookDown"
>;

export const CHASE_RIG_BLEND_SEC = 0.45;
export const CHASE_RIG_TOAST_SEC = 1.35;

export const CHASE_RIG_FOV_MIN = 72;
export const CHASE_RIG_FOV_MAX = 114;

const CLASSIC_MIN_DIST_XZ = 2.45;
const CLASSIC_PITCH_DOWN = -16;

const CHASE_ZERO_BODY = {
	bodyRight: 0,
	bodyUp: 0,
	bodyForward: 0,
	overheadHeight: 0,
} as const;

export const CHASE_RIGS: readonly ChaseRigPreset[] = [
	{
		id: "classic",
		labelKey: "hud.cam.classic",
		mount: "chase",
		distanceMul: 1,
		heightMul: 1,
		fovAddDeg: 0,
		lateralOffset: 0,
		lookLiftMul: 1,
		minDistXZ: CLASSIC_MIN_DIST_XZ,
		maxPitchDownDeg: CLASSIC_PITCH_DOWN,
		...CHASE_ZERO_BODY,
		springMul: 1,
		lookAheadMul: 1,
		lookAtCar: false,
		lookDown: false,
	},
	{
		id: "lowBoom",
		labelKey: "hud.cam.lowBoom",
		mount: "chase",
		distanceMul: 0.85,
		heightMul: 0.85,
		fovAddDeg: 4,
		lateralOffset: 0.35,
		lookLiftMul: 0.65,
		minDistXZ: 2.2,
		maxPitchDownDeg: -22,
		...CHASE_ZERO_BODY,
		springMul: 0.85,
		lookAheadMul: 1.05,
		lookAtCar: false,
		lookDown: false,
	},
	{
		id: "bumper",
		labelKey: "hud.cam.bumper",
		mount: "body",
		distanceMul: 1,
		heightMul: 1,
		fovAddDeg: 8,
		lateralOffset: 0,
		lookLiftMul: 0.7,
		minDistXZ: 0.35,
		maxPitchDownDeg: -28,
		/** Lekko za nosem / nad maską — auto w dole kadru. */
		bodyRight: 0,
		bodyUp: 0.78,
		bodyForward: 0.2,
		overheadHeight: 0,
		springMul: 0.18,
		lookAheadMul: 1.4,
		lookAtCar: false,
		lookDown: false,
	},
	{
		id: "wheel",
		labelKey: "hud.cam.wheel",
		mount: "body",
		distanceMul: 1,
		heightMul: 1,
		fovAddDeg: 0,
		lateralOffset: 0,
		lookLiftMul: 0.55,
		minDistXZ: 0.4,
		maxPitchDownDeg: -28,
		bodyRight: 1.55,
		bodyUp: 0.72,
		bodyForward: -0.55,
		overheadHeight: 0,
		springMul: 0.22,
		lookAheadMul: 1.15,
		lookAtCar: false,
		lookDown: false,
	},
	{
		id: "sideRail",
		labelKey: "hud.cam.sideRail",
		mount: "chase",
		distanceMul: 1.0,
		heightMul: 0.95,
		fovAddDeg: 4,
		lateralOffset: 5.0,
		lookLiftMul: 0.85,
		minDistXZ: 2.15,
		maxPitchDownDeg: -22,
		...CHASE_ZERO_BODY,
		springMul: 0.75,
		lookAheadMul: 1.05,
		lookAtCar: false,
		lookDown: false,
	},
	{
		id: "telephoto",
		labelKey: "hud.cam.telephoto",
		mount: "chase",
		distanceMul: 2.2,
		heightMul: 1.45,
		fovAddDeg: -18,
		lateralOffset: 0.5,
		lookLiftMul: 1.0,
		minDistXZ: 3.8,
		maxPitchDownDeg: -18,
		...CHASE_ZERO_BODY,
		springMul: 1.05,
		lookAheadMul: 0.9,
		lookAtCar: false,
		lookDown: false,
	},
	{
		id: "heroFront",
		labelKey: "hud.cam.heroFront",
		mount: "body",
		distanceMul: 1,
		heightMul: 1,
		fovAddDeg: -2,
		lateralOffset: 0,
		lookLiftMul: 0.95,
		minDistXZ: 0.5,
		maxPitchDownDeg: -28,
		bodyRight: 1.55,
		bodyUp: 1.15,
		bodyForward: 2.6,
		overheadHeight: 0,
		springMul: 0.35,
		lookAheadMul: 0.45,
		lookAtCar: true,
		lookDown: false,
	},
	{
		id: "highWide",
		labelKey: "hud.cam.highWide",
		mount: "chase",
		distanceMul: 1.85,
		heightMul: 2.8,
		fovAddDeg: 6,
		lateralOffset: 0.8,
		lookLiftMul: 1.15,
		minDistXZ: 3.0,
		maxPitchDownDeg: -32,
		...CHASE_ZERO_BODY,
		springMul: 1.0,
		lookAheadMul: 1.05,
		lookAtCar: false,
		lookDown: false,
	},
	{
		/**
		 * Prawdziwy widok z góry — kamera nad autem, look w dół na murawę.
		 */
		id: "topDown",
		labelKey: "hud.cam.topDown",
		mount: "overhead",
		distanceMul: 1,
		heightMul: 1,
		fovAddDeg: -8,
		lateralOffset: 0,
		lookLiftMul: 0.05,
		minDistXZ: 0.05,
		maxPitchDownDeg: -89,
		bodyRight: 0,
		bodyUp: 0,
		bodyForward: 0,
		overheadHeight: 14,
		springMul: 0.4,
		lookAheadMul: 0,
		lookAtCar: true,
		lookDown: true,
	},
] as const;

export const CLASSIC_CHASE_RIG: ChaseRigParams = {
	mount: "chase",
	distanceMul: 1,
	heightMul: 1,
	fovAddDeg: 0,
	lateralOffset: 0,
	lookLiftMul: 1,
	minDistXZ: CLASSIC_MIN_DIST_XZ,
	maxPitchDownDeg: CLASSIC_PITCH_DOWN,
	bodyRight: 0,
	bodyUp: 0,
	bodyForward: 0,
	overheadHeight: 0,
	springMul: 1,
	lookAheadMul: 1,
	lookAtCar: false,
	lookDown: false,
};

export function isBodyMountChaseRig(rig: ChaseRigParams): boolean {
	return rig.mount === "body";
}

export function isOverheadMountChaseRig(rig: ChaseRigParams): boolean {
	return rig.mount === "overhead" || rig.lookDown;
}

export function isOverheadChaseRig(rig: ChaseRigParams): boolean {
	return (
		isOverheadMountChaseRig(rig) ||
		(!isBodyMountChaseRig(rig) &&
			(rig.heightMul >= 5 || rig.minDistXZ < 1.5))
	);
}

export function isSpectacleChaseRig(rig: ChaseRigParams): boolean {
	return (
		isBodyMountChaseRig(rig) ||
		isOverheadMountChaseRig(rig) ||
		isOverheadChaseRig(rig)
	);
}

export function chaseRigIndex(id: ChaseRigId): number {
	const i = CHASE_RIGS.findIndex((r) => r.id === id);
	return i >= 0 ? i : 0;
}

export function chaseRigByIndex(index: number): ChaseRigPreset {
	const n = CHASE_RIGS.length;
	return CHASE_RIGS[((index % n) + n) % n]!;
}

export function nextChaseRigIndex(index: number): number {
	return (index + 1) % CHASE_RIGS.length;
}

export function lerpChaseRigParams(
	a: ChaseRigParams,
	b: ChaseRigParams,
	t: number,
): ChaseRigParams {
	const k = Math.min(1, Math.max(0, t));
	const mount = k < 0.5 ? a.mount : b.mount;
	const lookAtCar = k < 0.5 ? a.lookAtCar : b.lookAtCar;
	const lookDown = k < 0.5 ? a.lookDown : b.lookDown;
	return {
		mount,
		distanceMul: a.distanceMul + (b.distanceMul - a.distanceMul) * k,
		heightMul: a.heightMul + (b.heightMul - a.heightMul) * k,
		fovAddDeg: a.fovAddDeg + (b.fovAddDeg - a.fovAddDeg) * k,
		lateralOffset: a.lateralOffset + (b.lateralOffset - a.lateralOffset) * k,
		lookLiftMul: a.lookLiftMul + (b.lookLiftMul - a.lookLiftMul) * k,
		minDistXZ: a.minDistXZ + (b.minDistXZ - a.minDistXZ) * k,
		maxPitchDownDeg:
			a.maxPitchDownDeg + (b.maxPitchDownDeg - a.maxPitchDownDeg) * k,
		bodyRight: a.bodyRight + (b.bodyRight - a.bodyRight) * k,
		bodyUp: a.bodyUp + (b.bodyUp - a.bodyUp) * k,
		bodyForward: a.bodyForward + (b.bodyForward - a.bodyForward) * k,
		overheadHeight:
			a.overheadHeight + (b.overheadHeight - a.overheadHeight) * k,
		springMul: a.springMul + (b.springMul - a.springMul) * k,
		lookAheadMul: a.lookAheadMul + (b.lookAheadMul - a.lookAheadMul) * k,
		lookAtCar,
		lookDown,
	};
}

export function chaseRigBlendAlpha(blend01: number): number {
	const t = Math.min(1, Math.max(0, blend01));
	return 1 - (1 - t) ** 3;
}

export function clampChaseRigFov(horizontalDeg: number): number {
	return Math.min(
		CHASE_RIG_FOV_MAX,
		Math.max(CHASE_RIG_FOV_MIN, horizontalDeg),
	);
}
