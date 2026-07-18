import type * as THREE from "three";

/** Szerokość jednego pasa koszenia (m) — jak przejazd kosiarki z wałem. */
export const GRASS_MOW_BAND_METERS = 1.72;
/** Kontrast jasny/ciemny pas (0 = brak wzoru). */
export const GRASS_MOW_CONTRAST = 0.105;
/** Elipsa wzdłuż osi Z boiska (LENGTH > WIDTH). */
export const GRASS_MOW_ELLIPSE_Z = 1.38;

const MOW_CACHE_KEY = "flyball-grass-mow-v1";

/**
 * Koncentryczne elipsy/okręgi koszenia — jak na stadionie (światło na źdźbłach
 * zgiętych w naprzemiennych kierunkach, bez zmiany wysokości murawy).
 */
export function installGrassMowPattern(
	material: THREE.MeshStandardMaterial,
): void {
	material.customProgramCacheKey = () => MOW_CACHE_KEY;

	material.onBeforeCompile = (shader) => {
		shader.uniforms.uMowBandWidth = { value: GRASS_MOW_BAND_METERS };
		shader.uniforms.uMowContrast = { value: GRASS_MOW_CONTRAST };
		shader.uniforms.uMowEllipseZ = { value: GRASS_MOW_ELLIPSE_Z };

		shader.vertexShader = `varying vec2 vGrassWorldXZ;\n${shader.vertexShader}`;
		shader.vertexShader = shader.vertexShader.replace(
			"#include <worldpos_vertex>",
			`#include <worldpos_vertex>
				vGrassWorldXZ = worldPosition.xz;`,
		);

		shader.fragmentShader = `varying vec2 vGrassWorldXZ;
			uniform float uMowBandWidth;
			uniform float uMowContrast;
			uniform float uMowEllipseZ;
			${shader.fragmentShader}`;

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <map_fragment>",
			`#include <map_fragment>
				vec2 xz = vGrassWorldXZ;
				float rCircle = length(xz);
				float rEllipse = length(vec2(xz.x, xz.y / uMowEllipseZ));
				float bandC = fract(rCircle / uMowBandWidth * 0.5);
				float bandE = fract(rEllipse / (uMowBandWidth * 1.04) * 0.5);
				float stripe = mix(bandC, bandE, 0.58);
				float mowMul = mix(
					1.0 - uMowContrast,
					1.0 + uMowContrast,
					smoothstep(0.4, 0.6, stripe)
				);
				diffuseColor.rgb *= mowMul;`,
		);

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <normal_fragment_maps>",
			`#include <normal_fragment_maps>
				float ringNorm = fract(length(vGrassWorldXZ) / uMowBandWidth);
				float bladeTilt = (ringNorm - 0.5) * 0.14;
				normal = normalize(normal + vec3(0.0, bladeTilt, 0.0));`,
		);
	};
}
