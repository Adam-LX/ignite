import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
	computeCinematicIntensity,
	createCinematicPostFx,
} from "../../src/visual/cinematicPostFx";
import { SUPERSONIC_MPS } from "../../src/visual/supersonicBreak";

describe("computeCinematicIntensity", () => {
	it("returns 0 at standstill without boost", () => {
		expect(computeCinematicIntensity(0, false)).toBe(0);
	});

	it("ramps with speed toward supersonic", () => {
		const mid = computeCinematicIntensity(SUPERSONIC_MPS * 0.5, false);
		const fast = computeCinematicIntensity(SUPERSONIC_MPS, false);
		expect(mid).toBeGreaterThan(0.2);
		expect(fast).toBeGreaterThan(mid);
	});

	it("adds boost and pulse headroom", () => {
		const boosted = computeCinematicIntensity(0, true, 1);
		expect(boosted).toBeGreaterThan(0.5);
	});

	it("menu mode zeruje DoF w update", () => {
		const fx = createCinematicPostFx();
		fx.setMenuPresentation(true);
		fx.update(1 / 60, 0, false, 0, {
			focusUv: new THREE.Vector2(0.3, 0.4),
			dofStrength: 0.35,
			motionBlurDir: new THREE.Vector2(0, 0),
			motionBlurStrength: 0,
		});
		expect(fx.pass.uniforms.uDoFStrength.value).toBe(0);
	});

	it("winieta post-FX jest domyślnie wyłączona", () => {
		const fx = createCinematicPostFx();
		expect(fx.pass.uniforms.uVignette.value).toBe(0);
		fx.setVignette(0.5);
		expect(fx.pass.uniforms.uVignette.value).toBe(0.5);
	});
});
