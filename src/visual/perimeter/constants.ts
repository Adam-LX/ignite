import { RL_ARENA } from "../arenaConstants";

export const RAMP_WIDTH = RL_ARENA.RAMP_SIZE;
/** Wewnętrzna krawędź rampy — poziom murawy. */
export const RAMP_BASE_Y = 0;
export const RAMP_RUN = RAMP_WIDTH / Math.SQRT2;
/** Wysokość górnej krawędzi rampy — 45° przy run poziomy = RAMP_RUN. */
export const RAMP_TOP_Y = RAMP_RUN;
export const RAMP_CENTER_Y = RAMP_WIDTH / (2 * Math.SQRT2);

export const WALL_THICKNESS = 0.55;
export const WALL_VIS_DEPTH = 0.55;

export const LED_STRIP_WIDTH = 0.25;
export const LED_STRIP_LIFT = 0.02;
export const LED_POINT_INTENSITY = 2.0;
export const LED_POINT_DISTANCE = 20;
export const LED_LIGHT_COUNT = 8;

export const SHADOW_Y = 0.02;
export const SHADOW_WIDTH = 0.7;
export const SHADOW_RENDER_ORDER = 3;
