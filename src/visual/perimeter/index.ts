export { RAMP_BASE_Y, RAMP_RUN, RAMP_TOP_Y, RAMP_WIDTH } from "./constants";
export { buildProceduralArenaCage } from "./PerimeterCage";
export { PerimeterGeometry, perimeterGeometry } from "./PerimeterGeometry";
export {
	PerimeterLEDs,
	perimeterLEDs,
	updateRampSeamLeds,
} from "./PerimeterLEDs";
export { PerimeterShadows, perimeterShadows } from "./PerimeterShadows";
export {
	auditGoalRampSymmetry,
	buildPerimeterRibbonLoop,
	isGoalMouthSegment,
} from "./ribbon";
export { buildPerimeterSegments } from "./segments";
export type {
	PerimeterEdge,
	PerimeterSegment,
	RampTeam,
	RibbonVertex,
} from "./types";

import { getArenaPerimeterEdges } from "../arenaConstants";
import type { PerimeterEdge } from "./types";

export function getRlArenaOutlineEdges(): PerimeterEdge[] {
	return getArenaPerimeterEdges();
}
