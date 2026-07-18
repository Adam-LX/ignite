import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";

export const RAMP_WIDTH = RL_ARENA.RAMP_SIZE;
/**
 * Wewnętrzna krawędź rampy = górna powierzchnia murawy.
 * Dawniej 0 — próg 5 cm vs PLAYFIELD_SURFACE_Y podbijał auto przy wjeździe.
 */
export const RAMP_BASE_Y = PLAYFIELD_SURFACE_Y;
/**
 * Promień ćwiartki (run poziomy = wysokość względem bazy).
 * Dawniej /√2 pod prostą 45° — quarter-pipe używa pełnego RAMP_SIZE.
 */
export const RAMP_RUN = RAMP_WIDTH;
/** Górna krawędź rampy = styku ze ścianą pionową. */
export const RAMP_TOP_Y = RAMP_BASE_Y + RAMP_RUN;
export const RAMP_CENTER_Y = RAMP_BASE_Y + RAMP_WIDTH * (1 - Math.SQRT1_2);
/** Kroki profilu ćwiartki okręgu — płynny wjazd na ścianę jak w RL. */
export const RAMP_CURVE_STEPS = 12;

/**
 * Quarter-pipe RL: t=0 styczna pozioma (murawa), t=1 styczna pionowa (ściana).
 * run = R·sin(θ), heightAboveBase = R·(1−cos(θ)), θ = t·π/2.
 */
export function rampCurveHeight(t: number): number {
	const th = THREE_CLAMP01(t) * Math.PI * 0.5;
	return RAMP_RUN * (1 - Math.cos(th));
}

export function rampCurveRun(t: number): number {
	const th = THREE_CLAMP01(t) * Math.PI * 0.5;
	return RAMP_RUN * Math.sin(th);
}

/** Normalna powierzchni ćwiartki (w stronę boiska / „góry” względem opon). */
export function rampSurfaceNormal(
	t: number,
	outX: number,
	outZ: number,
): { x: number; y: number; z: number } {
	const th = THREE_CLAMP01(t) * Math.PI * 0.5;
	const s = Math.sin(th);
	const c = Math.cos(th);
	return { x: -outX * s, y: c, z: -outZ * s };
}

function THREE_CLAMP01(t: number): number {
	return t < 0 ? 0 : t > 1 ? 1 : t;
}

export const WALL_THICKNESS = 0.55;
export const WALL_VIS_DEPTH = 0.55;

/**
 * Fazowanie ściana→sufit — ćwiartka okręgu (jak rampa na dole).
 * Dawniej box 45° + wall na pełne HEIGHT = półka ~y=36.9.
 */
export const CEILING_COVE_RUN = 2.6;

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
export const LED_POINT_INTENSITY = 0.32;
export const LED_POINT_DISTANCE = 14;
export const LED_LIGHT_COUNT = 8;

export const SHADOW_Y = PLAYFIELD_SURFACE_Y + 0.005;
export const SHADOW_WIDTH = 0.7;
export const SHADOW_RENDER_ORDER = 3;
