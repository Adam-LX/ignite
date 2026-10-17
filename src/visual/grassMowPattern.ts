import type * as THREE from "three";
import { Vector2 } from "three";

import { STADIUM_PYLON_SPECS } from "./stadiumPylons";

/**
 * Proste pasy równoległe do linii bramkowych (oś Z) — jak Premier League / RL.
 * Szerokość ~ RL stadium (~5–6 jardów ≈ 4.5–5.5 m bywa za szeroko na naszą skalę;
 * 2.2 m czytelne z Ball Cam i nie „pasuje jak boisko juniorskie”).
 */
export const GRASS_MOW_BAND_METERS = 2.35;
/** Kontrast light/dark — czytelne pasy bez czarnych rowów. */
export const GRASS_MOW_CONTRAST = 0.4;
/** Zużycie / błoto przy golach i środku. */
export const GRASS_WEAR_STRENGTH = 0.08;
/** Specular flood — nisko, żeby nie zjadać pasów / nie robić mleka. */
export const GRASS_FLOOD_SPEC = 0.32;
export const GRASS_STADIUM_FALL_OFF = 0.06;

/** Zachowane dla testów / kompat — proste pasy nie używają elipsy. */
export const GRASS_MOW_ELLIPSE_Z = 1.0;

const MOW_CACHE_KEY = "flyball-grass-mow-v23-readable";

const FLOOD_AIMS: readonly Vector2[] = STADIUM_PYLON_SPECS.slice(0, 4).map(
	(s) => new Vector2(s.target[0] * 0.55, s.target[2] * 0.55),
);
const FLOOD_POS: readonly Vector2[] = STADIUM_PYLON_SPECS.slice(0, 4).map(
	(s) => new Vector2(s.x, s.z),
);

/**
 * Murawa stadionowa:
 * - proste pasy wzdłuż boiska (Z), naprzemiennie light/dark
 * - view-dependent sheen (źdźbła uginane do/od kamery)
 * - chlorophyll rim + blade flecks
 * - mikro-szum + wear przy golach
 * Ref: real athletic striping = light reflection off bent blades, not paint.
 */
export function installGrassMowPattern(
	material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
): void {
	material.customProgramCacheKey = () => MOW_CACHE_KEY;

	material.onBeforeCompile = (shader) => {
		shader.uniforms.uMowBandWidth = { value: GRASS_MOW_BAND_METERS };
		shader.uniforms.uMowContrast = { value: GRASS_MOW_CONTRAST };
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
			uniform float uWearStrength;
			uniform float uFloodSpec;
			uniform float uStadiumFall;
			uniform vec2 uFloodAim[4];
			uniform vec2 uFloodPos[4];

			float turfHash(vec2 p) {
				return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
			}
			float turfNoise(vec2 p) {
				vec2 i = floor(p);
				vec2 f = fract(p);
				float a = turfHash(i);
				float b = turfHash(i + vec2(1.0, 0.0));
				float c = turfHash(i + vec2(0.0, 1.0));
				float d = turfHash(i + vec2(1.0, 1.0));
				vec2 u = f * f * (3.0 - 2.0 * f);
				return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
			}
			${shader.fragmentShader}`;

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <map_fragment>",
			`#include <map_fragment>
				vec2 xz = vGrassWorldXZ;
				float nMicro = turfNoise(xz * 3.4);
				float nMacro = turfNoise(xz * 0.22);
				float nEdge = turfNoise(xz * 1.1);
				float nBlade = turfNoise(xz * 9.5);

				/**
				 * Proste pasy wzdłuż boiska (oś Z → bramki).
				 * Lekki jitter krawędzi — nie linia CAD.
				 */
				float bandCoord = xz.y / uMowBandWidth + (nEdge - 0.5) * 0.05;
				float stripe = fract(bandCoord);
				float bandId = floor(bandCoord);
				float bandFlip = mod(bandId, 2.0);

				/** Soft stadium stripe edges (nie schodek 1px). */
				float edgeSoft = smoothstep(0.0, 0.1, stripe) *
					(1.0 - smoothstep(0.9, 1.0, stripe));
				float stripeMask = mix(1.0 - edgeSoft * 0.28, edgeSoft, 0.12);

				/**
				 * View-dependent striping (wałek na murawie):
				 * pas „od kamery” = jaśniejszy, „do kamery” = ciemniejszy —
				 * ale zielony, nie błoto.
				 */
				vec3 V = normalize(cameraPosition - vec3(xz.x, 0.02, xz.y));
				vec2 viewXZ = normalize(V.xz + 1e-5);
				float bendSign = bandFlip * 2.0 - 1.0;
				float towardCam = clamp(viewXZ.y * bendSign, -1.0, 1.0);
				float stripeLum = mix(
					1.0 + uMowContrast * 0.95,
					1.0 - uMowContrast * 0.55,
					towardCam * 0.5 + 0.5
				);
				stripeLum = mix(stripeLum, 1.0, 0.12);
				stripeLum *= mix(0.985, 1.04, nMicro);

				/** Stadium greens — czytelne, nie fluoro. */
				vec3 darkTurf = vec3(0.62, 0.86, 0.42);
				vec3 lightTurf = vec3(0.92, 1.02, 0.58);
				vec3 mowTint = mix(darkTurf, lightTurf, bandFlip);
				mowTint *= stripeLum;

				/** Subsurface-ish chlorophyll when looking into flood. */
				float intoLight = 0.0;
				for (int i = 0; i < 4; i++) {
					vec3 L = normalize(vec3(uFloodPos[i].x, 52.0, uFloodPos[i].y) - vec3(xz.x, 0.02, xz.y));
					intoLight += max(dot(-V, L), 0.0);
				}
				intoLight = clamp(intoLight * 0.22, 0.0, 1.0);
				mowTint += vec3(0.08, 0.16, 0.04) * intoLight * (0.45 + 0.3 * bandFlip);

				/** Rim sheen na krawędziach pasów — błysk ugiętych źdźbeł. */
				float rim = pow(1.0 - abs(towardCam), 2.4) * edgeSoft;
				mowTint += vec3(0.16, 0.24, 0.08) * rim * 0.7;

				/** Subtelny checker w środkowym kole. */
				float inCenter = 1.0 - smoothstep(8.5, 11.5, length(xz));
				float check = mod(floor(xz.x / (uMowBandWidth * 0.85)) + bandId, 2.0);
				mowTint *= mix(1.0, mix(0.97, 1.04, check), inCenter * 0.22);

				/** Wear — lekki olive, nie brąz. */
				float goalZ = abs(xz.y);
				float goalWear = smoothstep(40.0, 54.0, goalZ) *
					smoothstep(30.0, 12.0, abs(xz.x));
				float midWear = smoothstep(14.0, 0.0, length(xz)) * 0.55;
				float sideline = smoothstep(30.0, 38.0, abs(xz.x)) *
					(1.0 - smoothstep(42.0, 54.0, abs(xz.y)));
				float wear = clamp(goalWear * 0.75 + midWear * 0.4 + sideline * 0.28, 0.0, 1.0);
				vec3 wearTint = mix(diffuseColor.rgb, vec3(0.58, 0.62, 0.32), wear * uWearStrength);

				/** Lift bazy albedo — bez neon wash. */
				diffuseColor.rgb *= 1.02;

				/** Mikro-źdźbła / flecks. */
				float fleck = mix(0.96, 1.05, nMicro) * mix(0.99, 1.025, nMacro);
				fleck *= mix(0.985, 1.03, nBlade);
				diffuseColor.rgb = wearTint * mowTint * fleck * mix(0.995, 1.0, stripeMask);

				/** Flood pools — słabsze niż pasy. */
				float poolSum = 0.0;
				float gloss = 0.0;
				vec3 worldPos = vec3(xz.x, 0.02, xz.y);
				vec3 N = normalize(vec3(
					(nMacro - 0.5) * 0.14 + (nMicro - 0.5) * 0.1,
					1.0,
					(nEdge - 0.5) * 0.12 + bendSign * 0.08
				));
				for (int i = 0; i < 4; i++) {
					vec2 toAim = xz - uFloodAim[i];
					float dPool = length(toAim) + (nMacro - 0.5) * 1.8;
					poolSum += exp(-dPool * dPool * 0.00155);
					vec3 L = normalize(vec3(uFloodPos[i].x, 52.0, uFloodPos[i].y) - worldPos);
					vec3 H = normalize(L + V);
					float ndh = max(dot(N, H), 0.0);
					gloss += pow(ndh, 36.0) * 0.5 + pow(ndh, 90.0) * 0.4 * nMicro;
				}
				float poolNorm = clamp(poolSum * 0.28, 0.0, 1.0);
				float stadiumMul = mix(1.0 - uStadiumFall * 0.35, 1.0 + uStadiumFall * 0.18, poolNorm);
				diffuseColor.rgb *= stadiumMul;
				/** Lightmap-style pools — ciepłe, ale pod kontrolą (bez mleka). */
				diffuseColor.rgb += vec3(0.55, 0.72, 0.38) * (poolNorm * 0.14 + gloss * 0.12) * uFloodSpec;
				diffuseColor.rgb += vec3(0.22, 0.38, 0.55) * poolNorm * 0.04 * (1.0 - bandFlip);

				/**
				 * Lokalna wilgoć (nie globalny clearcoat):
				 * mokre plamy + cienkie streaks wzdłuż pasów przy golach.
				 */
				float wetPatch = smoothstep(0.36, 0.72, nMacro) * smoothstep(0.3, 0.7, nEdge);
				float goalZone = smoothstep(36.0, 50.0, abs(xz.y)) * smoothstep(28.0, 10.0, abs(xz.x));
				float streak = abs(fract(xz.x * 0.55 + nMacro * 0.4) - 0.5);
				float streakMask = (1.0 - smoothstep(0.0, 0.08, streak)) * goalZone * 0.55;
				float wetLocal = clamp(wetPatch * 0.55 + streakMask + poolNorm * 0.35, 0.0, 1.0);
				diffuseColor.rgb *= mix(1.0, 0.94, wetLocal * 0.35);
				diffuseColor.rgb += vec3(0.4, 0.58, 0.36) * wetLocal * gloss * 0.1;`,
		);

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <roughnessmap_fragment>",
			`#include <roughnessmap_fragment>
				{
					float bCoordR = vGrassWorldXZ.y / uMowBandWidth;
					float bFlipR = mod(floor(bCoordR), 2.0);
					float bendR = bFlipR * 2.0 - 1.0;
					vec3 Vr = normalize(cameraPosition - vec3(vGrassWorldXZ.x, 0.02, vGrassWorldXZ.y));
					float towardR = clamp(normalize(Vr.xz + 1e-5).y * bendR, -1.0, 1.0);
					/** Ciemniejszy pas (do kamery) = nieco bardziej matowy; jasny = wetter sheen. */
					roughnessFactor *= mix(0.88, 1.06, towardR * 0.5 + 0.5);
					roughnessFactor *= mix(0.97, 1.03, turfNoise(vGrassWorldXZ * 4.2));
					float nW = turfNoise(vGrassWorldXZ * 0.22);
					float nE = turfNoise(vGrassWorldXZ * 1.1);
					float wetPatchR = smoothstep(0.36, 0.72, nW) * smoothstep(0.3, 0.7, nE);
					float goalW = smoothstep(36.0, 50.0, abs(vGrassWorldXZ.y)) *
						smoothstep(28.0, 10.0, abs(vGrassWorldXZ.x));
					float streakR = abs(fract(vGrassWorldXZ.x * 0.55 + nW * 0.4) - 0.5);
					float streakMaskR = (1.0 - smoothstep(0.0, 0.08, streakR)) * goalW * 0.55;
					float wetLocalR = clamp(wetPatchR * 0.55 + streakMaskR, 0.0, 1.0);
					roughnessFactor *= mix(1.0, 0.68, wetLocalR);
				}`,
		);

		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <normal_fragment_maps>",
			`#include <normal_fragment_maps>
				/** Normal tilt w kierunku pasów — specular „ugięcia” źdźbeł. */
				float bCoord = vGrassWorldXZ.y / uMowBandWidth;
				float bFlip = mod(floor(bCoord), 2.0);
				float tilt = (bFlip * 2.0 - 1.0) * 0.34;
				float nA = fract(sin(dot(vGrassWorldXZ * 2.7, vec2(12.9898, 78.233))) * 43758.5453);
				float nB = fract(sin(dot(vGrassWorldXZ * 5.1, vec2(39.346, 11.135))) * 24634.6345);
				float nC = fract(sin(dot(vGrassWorldXZ * 11.0, vec2(71.17, 19.91))) * 9123.41);
				normal = normalize(normal + vec3(
					(nA - 0.5) * 0.14 + (nC - 0.5) * 0.06,
					0.0,
					tilt + (nB - 0.5) * 0.12
				));`,
		);
	};
}
