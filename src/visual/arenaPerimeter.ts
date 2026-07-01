/**
 * Fasada wstecznej kompatybilności — logika obwodu w `src/visual/perimeter/`.
 */

export type { PerimeterEdge, PerimeterSegment, RampTeam } from "./perimeter";
export {
	buildPerimeterRibbonLoop,
	buildPerimeterSegments,
	buildProceduralArenaCage,
	getRlArenaOutlineEdges,
	RAMP_BASE_Y,
	RAMP_WIDTH,
	updateRampSeamLeds,
} from "./perimeter";
