/**
 * Path tracing / realtime RT stack — eksporty publiczne.
 */

export { MatchPathTracer } from "./MatchPathTracer";
export type { PathTraceFrameStats } from "./MatchPathTracer";
export { MatchRealtimeRT } from "./MatchRealtimeRT";
export type { RealtimeRtStats } from "./MatchRealtimeRT";
export { PathTraceDenoisePass } from "./PathTraceDenoisePass";
export { PathTraceBloomPass } from "./PathTraceBloomPass";
export { StadiumEnvProbe } from "./StadiumEnvProbe";
export {
	mountPitchPlanarReflection,
	disposePitchPlanarReflection,
	updatePitchPlanarReflection,
	compositePitchPlanarOverRt,
	VFX_REFLECTION_EXCLUDE_LAYER,
} from "./PitchPlanarReflection";
export {
	syncPathTraceAreaLights,
	disposePathTraceAreaLights,
} from "./PathTraceAreaLights";
export { applyPathTraceShadowFeel } from "./pathTraceShadows";
export { applyPathTraceLacquer } from "./pathTraceLacquer";
export { IgniteRtDirector } from "./IgniteRtDirector";
export type { RtDirectorFrameResult } from "./IgniteRtDirector";
export {
	ensureArenaRtProxy,
	disposeArenaRtProxy,
	hideArenaRtProxyForGBuffer,
	ARENA_RT_PROXY_NAME,
} from "./ArenaRtProxy";
export { ensureMatchGeometryVisible } from "./ensureMatchGeometryVisible";
export {
	tagSceneForRealtimeRt,
	sceneTopologySignature,
} from "./pathTraceSceneFilter";
