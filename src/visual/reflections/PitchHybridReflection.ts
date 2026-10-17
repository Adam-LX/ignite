/**
 * Hybrid pitch reflections — planar (IgniteRtDirector) + screen SSR fill + probe IBL.
 * Ten moduł tylko stroi wagi / dokumentuje kontrakt; SSR pass jest w aaaNextGen.
 */

import * as THREE from "three";

import { isPathTraceLookEnabled } from "../../util/presentationPrefs";
import type { GraphicsQuality } from "../../util/graphicsProfile";
import { getPitchWetness } from "../pitchWetness";

export type HybridReflectionWeights = {
	planarOpacityMul: number;
	ssrStrength: number;
	probeEnvMul: number;
};

export function resolveHybridReflectionWeights(
	quality: GraphicsQuality,
): HybridReflectionWeights {
	const pt = isPathTraceLookEnabled();
	const wet = THREE.MathUtils.clamp(getPitchWetness(), 0, 1);
	if (!pt || quality === "low" || quality === "deck") {
		return { planarOpacityMul: 0, ssrStrength: 0, probeEnvMul: 1 };
	}
	const high = quality === "high";
	return {
		/** Standard pitch: trawa > lustro. Lekki gloss + delikatny SSR. */
		planarOpacityMul: high ? 0.55 + wet * 0.08 : 0.45 + wet * 0.06,
		ssrStrength: high ? 0.18 + wet * 0.08 : 0.12 + wet * 0.06,
		probeEnvMul: high ? 1.08 : 1.04,
	};
}
