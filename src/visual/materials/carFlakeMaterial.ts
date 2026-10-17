/**
 * Metallic flake clearcoat — mikro-płatki w lakierze (UE6 / AAA car paint).
 */

import type * as THREE from "three";

const FLAKE_CACHE = "ignite-car-flake-v1";

export function installCarFlakeShader(
	material: THREE.MeshPhysicalMaterial,
	strength = 0.55,
): void {
	if (material.userData.igniteFlakeInstalled) return;
	material.userData.igniteFlakeInstalled = true;
	material.userData.igniteFlakeStrength = strength;
	const prevKey = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () =>
		`${prevKey?.() ?? material.type}-${FLAKE_CACHE}`;

	const prevCompile = material.onBeforeCompile;
	material.onBeforeCompile = (shader, renderer) => {
		prevCompile?.(shader, renderer);
		shader.uniforms.uFlakeStrength = {
			value: material.userData.igniteFlakeStrength as number,
		};
		if (!shader.fragmentShader.includes("uniform float uFlakeStrength")) {
			shader.fragmentShader = `uniform float uFlakeStrength;\n${shader.fragmentShader}`;
		}
		/** Po lighting — dodaj mikro-iskry clearcoatu. */
		if (shader.fragmentShader.includes("#include <lights_fragment_end>")) {
			shader.fragmentShader = shader.fragmentShader.replace(
				"#include <lights_fragment_end>",
				`#include <lights_fragment_end>
				{
					vec3 fp = vViewPosition * 0.35;
					float f1 = fract(sin(dot(fp.xy, vec2(12.9898, 78.233))) * 43758.5453);
					float f2 = fract(sin(dot(fp.yz, vec2(39.346, 11.135))) * 24634.6345);
					float flake = step(0.93, f1) * step(0.9, f2);
					float ndv = max(dot(normal, normalize(vViewPosition)), 0.0);
					float spark = pow(ndv, 56.0);
					reflectedLight.directSpecular += vec3(1.08, 1.02, 0.95) * flake * spark * uFlakeStrength;
					reflectedLight.indirectSpecular += vec3(0.55, 0.62, 0.75) * flake * uFlakeStrength * 0.25;
				}`,
			);
		}
	};
	material.needsUpdate = true;
}
