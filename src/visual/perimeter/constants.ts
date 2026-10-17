import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";

export const RAMP_WIDTH = RL_ARENA.RAMP_SIZE;
/**
 * Wewnętrzna krawędź rampy = górna powierzchnia murawy.
 * Dawniej 0 — próg 5 cm vs PLAYFIELD_SURFACE_Y podbijał auto przy wjeździe.
 */
export const RAMP_BASE_Y = PLAYFIELD_SURFACE_Y;

/**
 * Wzniesienie do pionu (RL ≈ 256 uu = 2.56 m).
 * Katalog `rampSize` = to właśnie.
 */
export const RAMP_RISE = RAMP_WIDTH;

/**
 * Poziomy „run” bandy — dłuższy niż rise (elipsa), żeby wjazd był łagodniejszy
 * niż czysty ćwierćokrąg RLBot (mesh nie jest idealnym kołem).
 */
export const RAMP_RUN_MUL = 1.42;
export const RAMP_RUN = RAMP_RISE * RAMP_RUN_MUL;

/** Górna krawędź rampy = styku ze ścianą pionową. */
export const RAMP_TOP_Y = RAMP_BASE_Y + RAMP_RISE;
export const RAMP_CENTER_Y = RAMP_BASE_Y + RAMP_RISE * (1 - Math.SQRT1_2);
/** Gęstszy profil = gładszy trimesh (mniej faset przy wall ride). */
export const RAMP_CURVE_STEPS = 18;

/**
 * Eliptyczny quarter-pipe: t=0 styczna pozioma, t=1 styczna pionowa.
 * run = R_run·sin(θ), height = R_rise·(1−cos(θ)).
 */
export function rampCurveHeight(t: number): number {
	const th = THREE_CLAMP01(t) * Math.PI * 0.5;
	return RAMP_RISE * (1 - Math.cos(th));
}

export function rampCurveRun(t: number): number {
	const th = THREE_CLAMP01(t) * Math.PI * 0.5;
	return RAMP_RUN * Math.sin(th);
}

/** Normalna powierzchni elipsy (w stronę boiska). */
export function rampSurfaceNormal(
	t: number,
	outX: number,
	outZ: number,
): { x: number; y: number; z: number } {
	const th = THREE_CLAMP01(t) * Math.PI * 0.5;
	const s = Math.sin(th);
	const c = Math.cos(th);
	const nx = RAMP_RISE * s;
	const ny = RAMP_RUN * c;
	const len = Math.hypot(nx, ny) || 1;
	return { x: (-outX * nx) / len, y: ny / len, z: (-outZ * nx) / len };
}

function THREE_CLAMP01(t: number): number {
	return t < 0 ? 0 : t > 1 ? 1 : t;
}

export const WALL_THICKNESS = 0.55;
export const WALL_VIS_DEPTH = 0.55;

/**
 * Fazowanie ściana→sufit — ćwiartka okręgu (jak rampa na dole).
 * Przy niższym suficie RL (~22 m) cove proporcjonalnie krótsze.
 */
export const CEILING_COVE_RUN = 2.2;

/**
 * Ćwiartki w głębi kieszeni bramki (za GOAL_MOUTH_CLEAR) — wall-ride tył/sufit.
 * Wlot zostaje płaski, żeby nie wywracać auta na linii.
 */
export const GOAL_COVE_RUN = 1.2;

export const LED_STRIP_WIDTH = 0.1;
/** Wciągnięcie w bandę/ścianę (wzdłuż out). */
export const LED_STRIP_RECESS = 0.04;
/** Offset wzdłuż normalnej powierzchni — tylko „farba”, bez półki. */
export const LED_STRIP_LIFT = 0.012;
export const LED_POINT_INTENSITY = 0.48;
export const LED_POINT_DISTANCE = 11;
export const LED_LIGHT_COUNT = 8;

export const SHADOW_Y = PLAYFIELD_SURFACE_Y + 0.005;
export const SHADOW_WIDTH = 1.05;
export const SHADOW_RENDER_ORDER = 3;
