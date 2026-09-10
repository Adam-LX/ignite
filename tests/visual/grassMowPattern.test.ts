import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
	GRASS_BUMP_AMPLITUDE,
	GRASS_FLOOD_SPEC,
	GRASS_MOW_BAND_METERS,
	GRASS_MOW_BLADE_TILT,
	GRASS_MOW_CONTRAST,
	getGrassMowShaderCacheKey,
	installGrassMowPattern,
} from "../../src/visual/grassMowPattern";

describe("grassMowPattern", () => {
	it("ustawia customProgramCacheKey i onBeforeCompile", () => {
		const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
		installGrassMowPattern(mat);
		expect(mat.customProgramCacheKey?.()).toBe(getGrassMowShaderCacheKey());
		expect(mat.onBeforeCompile).toBeTypeOf("function");
	});

	it("stałe pasów w rozsądnym zakresie", () => {
		expect(GRASS_MOW_BAND_METERS).toBeGreaterThan(1.2);
		expect(GRASS_MOW_BAND_METERS).toBeLessThan(2.5);
		expect(GRASS_MOW_CONTRAST).toBeGreaterThan(0.02);
		expect(GRASS_MOW_CONTRAST).toBeLessThan(0.12);
	});

	it("bump relief — amplituda i tilt w zakresie czytelności", () => {
		expect(GRASS_BUMP_AMPLITUDE).toBeGreaterThan(1.2);
		expect(GRASS_BUMP_AMPLITUDE).toBeLessThan(4.0);
		expect(GRASS_MOW_BLADE_TILT).toBeGreaterThan(0.04);
		expect(GRASS_MOW_BLADE_TILT).toBeLessThan(0.2);
		expect(GRASS_FLOOD_SPEC).toBeGreaterThan(0.1);
		expect(GRASS_FLOOD_SPEC).toBeLessThan(0.3);
	});

	it("shader zawiera proceduralny bump normal mapping", () => {
		const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
		installGrassMowPattern(mat);
		const probe: THREE.WebGLProgramParametersWithUniforms = {
			vertexShader: "#include <worldpos_vertex>",
			fragmentShader:
				"#include <map_fragment>\n#include <normal_fragment_maps>",
			uniforms: {},
		};
		mat.onBeforeCompile?.(probe);
		expect(probe.fragmentShader).toContain("grassBumpNormal");
		expect(probe.fragmentShader).toContain("grassHeight");
		expect(probe.fragmentShader).toContain("uGrassBumpAmp");
		expect(probe.fragmentShader).toContain("microOffset");
		expect(probe.fragmentShader).toContain("grassN");
	});
});
