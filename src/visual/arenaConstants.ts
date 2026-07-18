import type {
	ArenaDimensions,
	ArenaPerimeterEdge,
} from "../arena/ArenaDefinition";
import { ArenaRuntime } from "../arena/ArenaRuntime";

export type { ArenaDimensions, ArenaPerimeterEdge };

/** Górna powierzchnia murawy (Rapier floor collider top = center + halfY). */
export const PLAYFIELD_SURFACE_Y = 0.05;
export const PLAYFIELD_FLOOR_HALF_THICKNESS = 0.05;

/** Aktywny wymiary areny — proxy do ArenaRuntime (M5). */
export const RL_ARENA: ArenaDimensions = new Proxy({} as ArenaDimensions, {
	get(_target, prop: string | symbol) {
		const d = ArenaRuntime.getDimensions();
		if (prop === "GOAL_WING_X") {
			return d.HALF_WIDTH - d.CORNER_CUT;
		}
		if (typeof prop === "string" && prop in d) {
			return d[prop as keyof ArenaDimensions];
		}
		return undefined;
	},
});

/** Wewnętrzny narożnik na linii bramkowej — użyj getGoalWingX(). */
export function getGoalWingX(): number {
	return ArenaRuntime.getGoalWingX();
}

/**
 * Obwód CCW aktywnej areny — przerwy tylko na otwory bramkowe.
 */
export function getArenaPerimeterEdges(): ArenaPerimeterEdge[] {
	return ArenaRuntime.getPerimeterEdges();
}

/** Wierzchołki obwodu CCW (XZ) — wspólne dla murawy, trawy i ramp. */
export function getArenaPerimeterVertices(): { x: number; z: number }[] {
	return getArenaPerimeterEdges().map((e) => ({ x: e.ax, z: e.az }));
}

/** Alias dla oświetlenia i starszych importów. */
export const ARENA = {
	get width() {
		return RL_ARENA.WIDTH;
	},
	get length() {
		return RL_ARENA.LENGTH;
	},
	get height() {
		return RL_ARENA.HEIGHT;
	},
	get halfWidth() {
		return RL_ARENA.HALF_WIDTH;
	},
	get halfLength() {
		return RL_ARENA.HALF_LENGTH;
	},
} as const;
