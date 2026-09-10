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
/** Specular / soft pool od 4 jupiterów — umiarkowane; bump niesie mikro-gloss. */
export const GRASS_FLOOD_SPEC = 0.2;
/** Jaśniej pod snopami, ciemniej między — symulacja oświetlenia stadionu. */
export const GRASS_STADIUM_FALL_OFF = 0.16;
/** Amplituda proceduralnego mikro-reliefu źdźbeł (gradient height → normal). */
export const GRASS_BUMP_AMPLITUDE = 2.35;
/** Nachylenie źdźbeł wzdłuż pasów koszenia (tangent-space lean). */
export const GRASS_MOW_BLADE_TILT = 0.11;

const MOW_CACHE_KEY = "flyball-grass-mow-v24-bump-relief";

const FLOOD_AIMS: readonly Vector2[] = STADIUM_PYLON_SPECS.slice(0, 4).map(
	(s) => new Vector2(s.target[0] * 0.55, s.target[2] * 0.55),
);
const FLOOD_POS: readonly Vector2[] = STADIUM_PYLON_SPECS.slice(0, 4).map(
	(s) => new Vector2(s.x, s.z),
);

/** Proceduralny bump / mikro-relief źdźbeł — współdzielony przez diffuse pools i lighting. */
const GRASS_BUMP_GLSL = /* glsl */ `
float grassHash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float grassNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(grassHash(i), grassHash(i + vec2(1.0, 0.0)), u.x),
		mix(grassHash(i + vec2(0.0, 1.0)), grassHash(i + vec2(1.0, 1.0)), u.x),
		u.y
	);
}

float grassFbm(vec2 p) {
	float acc = 0.0;
	float amp = 0.5;
	mat2 rot = mat2(1.6, 1.2, -1.2, 1.6);
	for (int i = 0; i < 4; i++) {
		acc += amp * grassNoise(p);
		p = rot * p;
		amp *= 0.5;
	}
	return acc;
}

vec2 grassWarpXZ(vec2 xz) {
	vec2 warp = vec2(
		grassNoise(xz * 0.31) - 0.5,
		grassNoise(xz * 0.73) - 0.5
	) * 0.95;
	return xz + warp;
}

float grassMowStripe(vec2 xzw) {
	float rCircle = length(xzw);
	float rEllipse = length(vec2(xzw.x, xzw.y / uMowEllipseZ));
	float bandC = fract(rCircle / uMowBandWidth * 0.5);
	float bandE = fract(rEllipse / (uMowBandWidth * 1.06) * 0.5);
	float stripe = mix(bandC, bandE, 0.55);
	return smoothstep(0.18, 0.82, stripe);
}

float grassBladeField(vec2 xzw, float stripe) {
	float r = length(vec2(xzw.x, xzw.y / uMowEllipseZ));
	float ang = atan(xzw.y, xzw.x);
	float rowVar = mix(0.88, 1.12, stripe);
	float along = sin(ang * 26.0 * rowVar + grassNoise(xzw * 3.7) * 4.2) * 0.5 + 0.5;
	float across = sin(r * 46.0 + grassNoise(xzw * 5.1) * 3.4) * 0.5 + 0.5;
	float fiber = sin(dot(xzw, vec2(17.3, 23.7)) + grassNoise(xzw * 11.0) * 2.0) * 0.5 + 0.5;
	return along * across * mix(0.82, 1.0, fiber);
}

float grassHeight(vec2 xz) {
	vec2 xzw = grassWarpXZ(xz);
	float stripe = grassMowStripe(xzw);
	float micro = grassFbm(xzw * 20.0) * 0.52 + grassFbm(xzw * 52.0) * 0.22;
	float blades = grassBladeField(xzw, stripe);
	return micro * 0.42 + blades * 0.58;
}

vec3 grassBumpNormal(vec2 xz) {
	const float eps = 0.026;
	float h0 = grassHeight(xz);
	float hx = grassHeight(xz + vec2(eps, 0.0)) - h0;
	float hz = grassHeight(xz + vec2(0.0, eps)) - h0;
	vec3 n = normalize(vec3(-hx * uGrassBumpAmp, 1.0, -hz * uGrassBumpAmp));

	vec2 xzw = grassWarpXZ(xz);
	float stripe = grassMowStripe(xzw);
	float leanSign = mix(-1.0, 1.0, stripe);
	vec2 radial = normalize(xzw + vec2(0.001));
	vec2 tangent = vec2(-radial.y, radial.x);
	n = normalize(
		n + vec3(tangent.x * leanSign * uGrassMowTilt, 0.0, tangent.y * leanSign * uGrassMowTilt)
	);
	return n;
}
`;

/**
 * Subtelne pasy koszenia + proceduralny mikro-relief źdźbeł (bump normals),
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
		shader.uniforms.uGrassBumpAmp = { value: GRASS_BUMP_AMPLITUDE };
		shader.uniforms.uGrassMowTilt = { value: GRASS_MOW_BLADE_TILT };
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
			uniform float uGrassBumpAmp;
			uniform float uGrassMowTilt;
			uniform vec2 uFloodAim[4];
			uniform vec2 uFloodPos[4];
			${GRASS_BUMP_GLSL}
			${shader.fragmentShader}`;

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <map_fragment>",
			`#include <map_fragment>
				vec2 xz = vGrassWorldXZ;
				vec2 xzw = grassWarpXZ(xz);
				float n3 = grassNoise(xz * 1.9);
				float n4 = grassNoise(xz * 0.11);

				float stripe = grassMowStripe(xzw);
				float mowMul = mix(1.0 - uMowContrast, 1.0 + uMowContrast, stripe);
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
				 * Mikro-gloss używa grassBumpNormal — nie płaskiej N.
				 */
				float poolSum = 0.0;
				float gloss = 0.0;
				vec3 worldPos = vec3(xz.x, 0.02, xz.y);
				vec3 V = normalize(cameraPosition - worldPos);
				vec3 grassN = grassBumpNormal(xz);
				for (int i = 0; i < 4; i++) {
					float dPool = length(xz - uFloodAim[i]);
					poolSum += exp(-dPool * dPool * 0.00155);
					vec3 L = normalize(vec3(uFloodPos[i].x, 52.0, uFloodPos[i].y) - worldPos);
					vec3 H = normalize(L + V);
					gloss += pow(max(dot(grassN, H), 0.0), 58.0);
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

				float flood = poolNorm * 0.5 + gloss * 0.55;
				diffuseColor.rgb += vec3(0.62, 0.78, 1.0) * flood * uFloodSpec;`,
		);

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <normal_fragment_maps>",
			`#include <normal_fragment_maps>
				vec3 grassN = grassBumpNormal(vGrassWorldXZ);
				vec3 worldNormal = normalize(transpose(mat3(viewMatrix)) * normal);
				vec3 microOffset = grassN - vec3(0.0, 1.0, 0.0);
				worldNormal = normalize(worldNormal + microOffset);
				normal = normalize(mat3(viewMatrix) * worldNormal);`,
		);
	};
}

/** Cache key shadera mow+bump — do testów kontraktowych. */
export function getGrassMowShaderCacheKey(): string {
	return MOW_CACHE_KEY;
}
