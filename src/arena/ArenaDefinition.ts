/** Wymiary areny — płaski widok kompatybilny z RL_ARENA. */
export type ArenaDimensions = {
	readonly WIDTH: number;
	readonly LENGTH: number;
	readonly HEIGHT: number;
	readonly HALF_WIDTH: number;
	readonly HALF_LENGTH: number;
	readonly GOAL_WIDTH: number;
	readonly GOAL_HEIGHT: number;
	readonly GOAL_DEPTH: number;
	readonly RAMP_SIZE: number;
	readonly CORNER_CUT: number;
};

export type ArenaPerimeterEdge = {
	ax: number;
	az: number;
	bx: number;
	bz: number;
};

export type ArenaPerimeterPreset = "rlOctagon" | "custom";

export type ArenaSpawnConfig = {
	preset: "rlKickoff";
	scaleFromStandard: number;
};

export type ArenaBoostPadConfig = {
	preset: "rlSoccar";
	enabled: boolean;
};

export type ArenaAtmosphere = {
	skyPreset?: string;
	neonAccent?: string;
};

export type ArenaDefinition = {
	id: string;
	nameKey: string;
	defaultUnlocked: boolean;
	dimensions: {
		width: number;
		length: number;
		height: number;
		cornerCut: number;
		goalWidth: number;
		goalHeight: number;
		goalDepth: number;
		rampSize: number;
	};
	perimeterPreset: ArenaPerimeterPreset;
	customEdges?: ArenaPerimeterEdge[];
	manifest: string;
	spawns: ArenaSpawnConfig;
	boostPads: ArenaBoostPadConfig;
	atmosphere?: ArenaAtmosphere;
	trellisProps?: string[];
};

export type ArenaCatalogData = {
	schemaVersion: number;
	arenas: ArenaDefinition[];
};

/** Konwertuje wymiary JSON → płaski RL_ARENA. */
export function flattenArenaDimensions(
	d: ArenaDefinition["dimensions"],
): ArenaDimensions {
	const halfW = d.width / 2;
	const halfL = d.length / 2;
	return {
		WIDTH: d.width,
		LENGTH: d.length,
		HEIGHT: d.height,
		HALF_WIDTH: halfW,
		HALF_LENGTH: halfL,
		GOAL_WIDTH: d.goalWidth,
		GOAL_HEIGHT: d.goalHeight,
		GOAL_DEPTH: d.goalDepth,
		RAMP_SIZE: d.rampSize,
		CORNER_CUT: d.cornerCut,
	};
}

function mirrorEdgeX(e: ArenaPerimeterEdge): ArenaPerimeterEdge {
	return { ax: -e.bx, az: e.bz, bx: -e.ax, bz: e.az };
}

/** Segmenty łuku — ćwiartka okręgu zamiast ostrej fazy narożnika. */
export const CORNER_ARC_STEPS = 10;

function quarterArcEdges(
	cx: number,
	cz: number,
	radius: number,
	theta0: number,
	theta1: number,
	steps: number = CORNER_ARC_STEPS,
): ArenaPerimeterEdge[] {
	const edges: ArenaPerimeterEdge[] = [];
	for (let i = 0; i < steps; i++) {
		const t0 = i / steps;
		const t1 = (i + 1) / steps;
		const a0 = theta0 + (theta1 - theta0) * t0;
		const a1 = theta0 + (theta1 - theta0) * t1;
		edges.push({
			ax: cx + Math.cos(a0) * radius,
			az: cz + Math.sin(a0) * radius,
			bx: cx + Math.cos(a1) * radius,
			bz: cz + Math.sin(a1) * radius,
		});
	}
	return edges;
}

/** Obwód RL CCW z wymiarów mapy — narożniki jako łagodne łuki. */
export function buildRlOctagonEdges(d: ArenaDimensions): ArenaPerimeterEdge[] {
	const { HALF_WIDTH: hw, HALF_LENGTH: hl, CORNER_CUT: cc, GOAL_WIDTH } = d;
	const gw = GOAL_WIDTH / 2;

	const endBluePos: ArenaPerimeterEdge = {
		ax: gw,
		az: -hl,
		bx: hw - cc,
		bz: -hl,
	};
	/** Niebieski +X: θ −π/2 → 0 wokół (hw−cc, −hl+cc). */
	const cornerBlueToWall = quarterArcEdges(hw - cc, -hl + cc, cc, -Math.PI / 2, 0);
	const wallLo: ArenaPerimeterEdge = { ax: hw, az: -hl + cc, bx: hw, bz: 0 };
	const wallHi: ArenaPerimeterEdge = { ax: hw, az: 0, bx: hw, bz: hl - cc };
	/** Pomarańczowy +X: θ 0 → +π/2 wokół (hw−cc, hl−cc). */
	const cornerOrange = quarterArcEdges(hw - cc, hl - cc, cc, 0, Math.PI / 2);
	const endOrangePos: ArenaPerimeterEdge = {
		ax: hw - cc,
		az: hl,
		bx: gw,
		bz: hl,
	};

	const rightWall = [...cornerBlueToWall, wallLo, wallHi, ...cornerOrange];
	/** Lustrzane łuki: reverse + mirror, żeby zachować CCW. */
	const leftWall = [
		...[...cornerOrange].reverse().map(mirrorEdgeX),
		mirrorEdgeX(wallHi),
		mirrorEdgeX(wallLo),
		...[...cornerBlueToWall].reverse().map(mirrorEdgeX),
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

export function getPerimeterEdgesForDefinition(
	def: ArenaDefinition,
): ArenaPerimeterEdge[] {
	const flat = flattenArenaDimensions(def.dimensions);
	if (def.perimeterPreset === "custom" && def.customEdges?.length) {
		return def.customEdges;
	}
	return buildRlOctagonEdges(flat);
}

export function getGoalWingX(d: ArenaDimensions): number {
	return d.HALF_WIDTH - d.CORNER_CUT;
}

/** Standard RL 80×120 — domyślna mapa. */
export const STANDARD_ARENA_DEFINITION: ArenaDefinition = {
	id: "standard",
	nameKey: "arena.standard",
	defaultUnlocked: true,
	dimensions: {
		width: 80,
		length: 120,
		height: 40,
		cornerCut: 16.5,
		/** RLBot UU/100: 17.86 × 6.43 × 8.80 */
		goalWidth: 17.86,
		goalHeight: 6.43,
		goalDepth: 8.8,
		rampSize: 3.2,
	},
	perimeterPreset: "rlOctagon",
	manifest: "/assets/arenas/standard/manifest.json",
	spawns: { preset: "rlKickoff", scaleFromStandard: 1.0 },
	boostPads: { preset: "rlSoccar", enabled: false },
	atmosphere: { skyPreset: "cyberpunk", neonAccent: "cyan" },
};
