import type * as THREE from "three";
import { Vector2 } from "three";

import { STADIUM_PYLON_SPECS } from "./stadiumPylons";

/** Szerokość jednego pasa koszenia (m). */
export const GRASS_MOW_BAND_METERS = 1.55;
/** Subtelne pasy — charakter murawy to światło snopów, nie koszenie. */
export const GRASS_MOW_CONTRAST = 0.05;
/** Elipsa wzdłuż osi Z boiska. */
export const GRASS_MOW_ELLIPSE_Z = 1.42;
/** Zużycie przy golach / środku / bandach. */
export const GRASS_WEAR_STRENGTH = 0.1;
/** Specular / soft pool od 4 jupiterów. */
export const GRASS_FLOOD_SPEC = 0.22;
/** Jaśniej pod snopami, ciemniej między — symulacja oświetlenia stadionu. */
export const GRASS_STADIUM_FALL_OFF = 0.16;

const MOW_CACHE_KEY = "flyball-grass-mow-v10-light-pools";

const FLOOD_AIMS: readonly Vector2[] = STADIUM_PYLON_SPECS.slice(0, 4).map(
	(s) => new Vector2(s.target[0] * 0.55, s.target[2] * 0.55),
);
const FLOOD_POS: readonly Vector2[] = STADIUM_PYLON_SPECS.slice(0, 4).map(
	(s) => new Vector2(s.x, s.z),
);

/**
 * Subtelne pasy koszenia + nieregularność trawy (noise warp),
 * bez „pasów jak na dywanie” + 4 soft specular pools od jupiterów.
 */
export function installGrassMowPattern(
	material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
): void {
	material.customProgramCacheKey = () => MOW_CACHE_KEY;

	material.onBeforeCompile = (shader) => {
		shader.uniforms.uMowBandWidth = { value: GRASS_MOW_BAND_METERS };
		shader.uniforms.uMowContrast = { value: GRASS_MOW_CONTRAST };
		shader.uniforms.uMowEllipseZ = { value: GRASS_MOW_ELLIPSE_Z };
		shader.uniforms.uWearStrength = { value: GRASS_WEAR_STRENGTH };
		shader.uniforms.uFloodSpec = { value: GRASS_FLOOD_SPEC };
		shader.uniforms.uStadiumFall = { value: GRASS_STADIUM_FALL_OFF };
		shader.uniforms.uFloodAim = {
			value: FLOOD_AIMS.map((v) => v.clone()),
		};
		shader.uniforms.uFloodPos = {
			value: FLOOD_POS.map((v) => v.clone()),
		};

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
			uniform float uWearStrength;
			uniform float uFloodSpec;
			uniform float uStadiumFall;
			uniform vec2 uFloodAim[4];
			uniform vec2 uFloodPos[4];
			${shader.fragmentShader}`;

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <map_fragment>",
			`#include <map_fragment>
				vec2 xz = vGrassWorldXZ;
				/** Nieregularność trawy — łamie idealne elipsy. */
				float n1 = fract(sin(dot(xz * 0.31, vec2(12.9898, 78.233))) * 43758.5453);
				float n2 = fract(sin(dot(xz * 0.73, vec2(39.346, 11.135))) * 24634.6345);
				float n3 = fract(sin(dot(xz * 1.9, vec2(7.13, 67.19))) * 9123.41);
				float n4 = fract(sin(dot(xz * 0.11, vec2(91.7, 23.4))) * 59127.13);
				vec2 warp = vec2(n1 - 0.5, n2 - 0.5) * 0.95;
				vec2 xzw = xz + warp;

				float rCircle = length(xzw);
				float rEllipse = length(vec2(xzw.x, xzw.y / uMowEllipseZ));
				float bandC = fract(rCircle / uMowBandWidth * 0.5);
				float bandE = fract(rEllipse / (uMowBandWidth * 1.06) * 0.5);
				float stripe = mix(bandC, bandE, 0.55);
				/** Miękkie krawędzie — pasy widoczne, bez ostrych łat. */
				float edge = smoothstep(0.18, 0.82, stripe);
				float mowMul = mix(1.0 - uMowContrast, 1.0 + uMowContrast, edge);
				mowMul *= mix(0.97, 1.03, n3);

				float goalZ = abs(xz.y);
				float goalWear = smoothstep(40.0, 54.0, goalZ) *
					smoothstep(30.0, 12.0, abs(xz.x));
				float midWear = smoothstep(16.0, 0.0, length(xz)) * 0.7;
				float sideline = smoothstep(30.0, 38.0, abs(xz.x)) *
					(1.0 - smoothstep(42.0, 54.0, abs(xz.y)));
				float wear = clamp(goalWear * 0.75 + midWear * 0.4 + sideline * 0.28, 0.0, 1.0);
				vec3 wearTint = mix(diffuseColor.rgb, vec3(0.48, 0.42, 0.28), wear * uWearStrength);
				diffuseColor.rgb = wearTint * mowMul;

				/**
				 * Stadium character bez SM:
				 * 1) soft pools pod 4 jupiterami
				 * 2) ciemniejsze „między snopami”
				 * 3) lekki edge falloff przy bandach
				 */
				float poolSum = 0.0;
				float gloss = 0.0;
				vec3 worldPos = vec3(xz.x, 0.02, xz.y);
				vec3 V = normalize(cameraPosition - worldPos);
				vec3 N = vec3(0.0, 1.0, 0.0);
				for (int i = 0; i < 4; i++) {
					float dPool = length(xz - uFloodAim[i]);
					poolSum += exp(-dPool * dPool * 0.00155);
					vec3 L = normalize(vec3(uFloodPos[i].x, 52.0, uFloodPos[i].y) - worldPos);
					vec3 H = normalize(L + V);
					gloss += pow(max(dot(N, H), 0.0), 72.0);
				}
				float poolNorm = clamp(poolSum * 0.42, 0.0, 1.0);
				float between = 1.0 - smoothstep(0.15, 0.85, poolNorm);
				float edgeDark = smoothstep(34.0, 42.0, max(abs(xz.x), abs(xz.y) * 0.72));
				float blotch = mix(0.96, 1.05, n4);
				float stadiumMul = mix(1.0 - uStadiumFall * 0.85, 1.0 + uStadiumFall, poolNorm);
				stadiumMul *= mix(1.0, 0.92, between * 0.65);
				stadiumMul *= mix(1.0, 0.9, edgeDark * 0.55);
				stadiumMul *= blotch;
				diffuseColor.rgb *= stadiumMul;

				float flood = poolNorm * 0.55 + gloss * 0.65;
				diffuseColor.rgb += vec3(0.62, 0.78, 1.0) * flood * uFloodSpec;`,
		)

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <normal_fragment_maps>",
			`#include <normal_fragment_maps>
				float ringNorm = fract(length(vGrassWorldXZ) / uMowBandWidth);
				float bladeTilt = (ringNorm - 0.5) * 0.12;
				normal = normalize(normal + vec3(bladeTilt * 0.25, 0.0, bladeTilt));`,
		);
	};
}
