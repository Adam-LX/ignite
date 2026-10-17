/**
 * Soft contact-hardening shadows + emissive pylons przy Path tracing ON.
 * (WebGL shadow maps; pełne RT shadows wymagają WebGPU / natywnego RT.)
 */

import * as THREE from "three";

import type { StadiumLightingRig } from "../stadiumLighting";
import { isPathTraceLookEnabled } from "../../util/presentationPrefs";

export function applyPathTraceShadowFeel(rig: StadiumLightingRig): void {
	const pt = isPathTraceLookEnabled();
	const primary = rig.primaryShadow;
	if (primary?.shadow) {
		primary.shadow.radius = pt ? 8.5 : 4.2;
		primary.shadow.bias = pt ? -0.00018 : -0.00022;
		primary.shadow.normalBias = pt ? 0.035 : 0.028;
	}
	for (const spot of rig.cornerSpots ?? []) {
		if (!spot.shadow) continue;
		spot.shadow.radius = pt ? 7.2 : 3.8;
	}

	/** Shared bulb materials live on meshes under the same scene graph. */
	const root = primary?.parent;
	if (!root) return;
	const seen = new Set<THREE.Material>();
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const m of mats) {
			if (!(m instanceof THREE.MeshStandardMaterial)) continue;
			if (seen.has(m)) continue;
			if (m.emissiveIntensity < 0.05 || m.emissive.getHex() === 0) continue;
			seen.add(m);
	m.emissiveIntensity = pt ? 1.15 : 0.18;
		}
	});
}
