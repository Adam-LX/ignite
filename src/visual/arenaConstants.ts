/** Oficjalne wymiary areny Rocket League — skala 1:1 w metrach. */
export const RL_ARENA = {
	WIDTH: 80,
	LENGTH: 120,
	HEIGHT: 40,
	HALF_WIDTH: 40,
	HALF_LENGTH: 60,
	GOAL_WIDTH: 18,
	GOAL_HEIGHT: 6,
	GOAL_DEPTH: 6,
	RAMP_SIZE: 2.5,
	CORNER_CUT: 16.5,
} as const;

/** Krawędzie obwodu podłogi CCW — przerwy tylko na otwory bramkowe (GOAL_WIDTH). */
export type ArenaPerimeterEdge = {
	ax: number;
	az: number;
	bx: number;
	bz: number;
};

/** Lustrzane odbicie krawędzi względem płaszczyzny X=0 (zachowuje CCW). */
function mirrorEdgeX(e: ArenaPerimeterEdge): ArenaPerimeterEdge {
	return { ax: -e.bx, az: e.bz, bx: -e.ax, bz: e.az };
}

/**
 * Obwód CCW generowany symetrycznie: kanoniczna prawa strona (+X) + lustrzane odbicie lewej.
 * Eliminuje ręczne rozjazdy znaków współrzędnych przy bramkach.
 */
export function getArenaPerimeterEdges(): ArenaPerimeterEdge[] {
	const {
		HALF_WIDTH: hw,
		HALF_LENGTH: hl,
		CORNER_CUT: cc,
		GOAL_WIDTH,
	} = RL_ARENA;
	const gw = GOAL_WIDTH / 2;

	const endBluePos: ArenaPerimeterEdge = {
		ax: gw,
		az: -hl,
		bx: hw - cc,
		bz: -hl,
	};
	const cornerBlueToWall: ArenaPerimeterEdge = {
		ax: hw - cc,
		az: -hl,
		bx: hw,
		bz: -hl + cc,
	};
	const wallLo: ArenaPerimeterEdge = { ax: hw, az: -hl + cc, bx: hw, bz: 0 };
	const wallHi: ArenaPerimeterEdge = { ax: hw, az: 0, bx: hw, bz: hl - cc };
	const cornerOrange: ArenaPerimeterEdge = {
		ax: hw,
		az: hl - cc,
		bx: hw - cc,
		bz: hl,
	};
	const endOrangePos: ArenaPerimeterEdge = {
		ax: hw - cc,
		az: hl,
		bx: gw,
		bz: hl,
	};

	const rightWall = [cornerBlueToWall, wallLo, wallHi, cornerOrange];
	const leftWall = [
		mirrorEdgeX(cornerOrange),
		mirrorEdgeX(wallHi),
		mirrorEdgeX(wallLo),
		mirrorEdgeX(cornerBlueToWall),
	];

	return [
		mirrorEdgeX(endBluePos),
		endBluePos,
		...rightWall,
		endOrangePos,
		mirrorEdgeX(endOrangePos),
		...leftWall,
	];
}

/** Wierzchołki obwodu CCW (XZ) — wspólne dla murawy, trawy i ramp. */
export function getArenaPerimeterVertices(): { x: number; z: number }[] {
	return getArenaPerimeterEdges().map((e) => ({ x: e.ax, z: e.az }));
}

/** Alias dla oświetlenia i starszych importów. */
export const ARENA = {
	width: RL_ARENA.WIDTH,
	length: RL_ARENA.LENGTH,
	height: RL_ARENA.HEIGHT,
	halfWidth: RL_ARENA.HALF_WIDTH,
	halfLength: RL_ARENA.HALF_LENGTH,
} as const;
