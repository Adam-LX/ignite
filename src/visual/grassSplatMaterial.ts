import * as THREE from "three";

import { assetUrl } from "../util/assetUrl";
import { RL_ARENA } from "./arenaConstants";
import { GRASS_TILE_METERS } from "./materials";
import type { StadiumLightingRig } from "./stadiumLighting";

const TEX_BASE = assetUrl("/assets/textures");

const dummyShadowTexture = (() => {
	const tex = new THREE.DataTexture(
		new Float32Array([1]),
		1,
		1,
		THREE.RedFormat,
	);
	tex.needsUpdate = true;
	return tex;
})();

let pitchSplatCache: THREE.ShaderMaterial | null = null;

function loadRepeatTexture(path: string): THREE.Texture {
	const tex = new THREE.TextureLoader().load(path);
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 16;
	return tex;
}

/**
 * SplatMap murawy — 4 warstwy ComfyUI/proceduralne, jedna mapa rozkładu na całą arenę.
 * World-space UV + hash macro-variation — bez regularnej szachownicy.
 */
export function createPitchGrassSplatMaterial(): THREE.ShaderMaterial {
	if (pitchSplatCache) return pitchSplatCache;

	const tGrassMain = loadRepeatTexture(`${TEX_BASE}/arena_grass_main.png`);
	const tMossDetail = loadRepeatTexture(`${TEX_BASE}/arena_moss_detail.png`);
	const tSandWear = loadRepeatTexture(`${TEX_BASE}/arena_sand_wear.png`);
	const tMudWear = loadRepeatTexture(`${TEX_BASE}/arena_mud_wear.png`);
	const tSplatMap = loadRepeatTexture(`${TEX_BASE}/arena_splat_map.png`);
	tSplatMap.wrapS = THREE.ClampToEdgeWrapping;
	tSplatMap.wrapT = THREE.ClampToEdgeWrapping;
	tSplatMap.colorSpace = THREE.LinearSRGBColorSpace;

	const arenaSize = new THREE.Vector2(RL_ARENA.WIDTH, RL_ARENA.LENGTH);
	const arenaHalf = new THREE.Vector2(
		RL_ARENA.HALF_WIDTH,
		RL_ARENA.HALF_LENGTH,
	);

	pitchSplatCache = new THREE.ShaderMaterial({
		name: "pitchGrassSplat",
		uniforms: {
			tSplatMap: { value: tSplatMap },
			tGrassMain: { value: tGrassMain },
			tMossDetail: { value: tMossDetail },
			tSandWear: { value: tSandWear },
			tMudWear: { value: tMudWear },
			uTileMeters: { value: GRASS_TILE_METERS },
			uArenaSize: { value: arenaSize },
			uArenaHalf: { value: arenaHalf },
			uShadowMap: { value: dummyShadowTexture },
			uShadowMatrix: { value: new THREE.Matrix4() },
			uShadowEnabled: { value: 0 },
		},
		vertexShader: /* glsl */ `
			varying vec2 vWorldUv;
			varying vec2 vSplatUv;
			varying vec3 vWorldPos;

			uniform float uTileMeters;
			uniform vec2 uArenaSize;
			uniform vec2 uArenaHalf;

			void main() {
				vec4 worldPos = modelMatrix * vec4(position, 1.0);
				vWorldPos = worldPos.xyz;
				vWorldUv = worldPos.xz / uTileMeters;
				vSplatUv = (worldPos.xz + uArenaHalf) / uArenaSize;
				gl_Position = projectionMatrix * viewMatrix * worldPos;
			}
		`,
		fragmentShader: /* glsl */ `
			varying vec2 vWorldUv;
			varying vec2 vSplatUv;
			varying vec3 vWorldPos;

			uniform sampler2D tSplatMap;
			uniform sampler2D tGrassMain;
			uniform sampler2D tMossDetail;
			uniform sampler2D tSandWear;
			uniform sampler2D tMudWear;
			uniform sampler2D uShadowMap;
			uniform mat4 uShadowMatrix;
			uniform float uShadowEnabled;

			float hash21(vec2 p) {
				return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
			}

			float sampleArenaShadow(vec3 worldPos) {
				if (uShadowEnabled < 0.5) return 1.0;
				vec4 sc = uShadowMatrix * vec4(worldPos + vec3(0.0, 0.04, 0.0), 1.0);
				sc.xyz /= sc.w;
				sc.xyz = sc.xyz * 0.5 + 0.5;
				if (
					sc.x < 0.0 || sc.x > 1.0 ||
					sc.y < 0.0 || sc.y > 1.0 ||
					sc.z > 1.0
				) return 1.0;
				float shadow = 0.0;
				vec2 texel = vec2(1.0 / 2048.0);
				for (int x = -1; x <= 1; x++) {
					for (int y = -1; y <= 1; y++) {
						vec2 off = vec2(float(x), float(y)) * texel;
						float closest = texture2D(uShadowMap, sc.xy + off).r;
						shadow += sc.z - 0.0012 > closest ? 0.0 : 1.0;
					}
				}
				return shadow / 9.0;
			}

			void main() {
				vec4 splat = texture2D(tSplatMap, clamp(vSplatUv, 0.0, 1.0));

				vec2 uv = vWorldUv;
				vec2 uv2 = uv * vec2(1.047, 0.983) + vec2(0.11, 0.19);
				vec4 cGrass = texture2D(tGrassMain, uv);
				vec4 cGrassB = texture2D(tGrassMain, uv2);
				vec3 grass = mix(cGrass.rgb, cGrassB.rgb, 0.35);

				vec4 cMoss = texture2D(tMossDetail, uv * vec2(0.847, 1.131) + vec2(0.17, 0.29));
				vec4 cSand = texture2D(tSandWear, uv * vec2(1.173, 0.921) + vec2(0.41, 0.07));
				vec4 cMud = texture2D(tMudWear, uv * vec2(0.733, 1.089) + vec2(0.23, 0.53));

				vec3 color = grass;
				color = mix(color, cMoss.rgb, splat.r * 0.82);
				color = mix(color, cSand.rgb, splat.g * 0.88);
				color = mix(color, cMud.rgb, splat.b * 0.82);

				float macro = hash21(floor(vWorldUv * 0.42));
				float micro = hash21(floor(vWorldUv * 2.7) + vec2(17.0, 31.0));
				color *= 0.93 + macro * 0.11 + micro * 0.04;

				float shade = 0.74 + 0.26 * clamp(vWorldPos.y * 0.5 + 0.5, 0.0, 1.0);
				color *= shade;

				float shadow = sampleArenaShadow(vWorldPos);
				color *= mix(0.55, 1.0, shadow);

				gl_FragColor = vec4(color, 1.0);
			}
		`,
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
	});

	return pitchSplatCache;
}

export function bindGrassSplatAnisotropy(renderer: THREE.WebGLRenderer): void {
	if (!pitchSplatCache) return;
	const max = renderer.capabilities.getMaxAnisotropy();
	for (const key of [
		"tGrassMain",
		"tMossDetail",
		"tSandWear",
		"tMudWear",
	] as const) {
		const tex = pitchSplatCache.uniforms[key]?.value as
			| THREE.Texture
			| undefined;
		if (tex) tex.anisotropy = max;
	}
}

export function syncGrassSplatShadow(rig: StadiumLightingRig): void {
	if (!pitchSplatCache) return;
	const light = rig.primaryShadow;
	const shadowMap = light.shadow.map;
	pitchSplatCache.uniforms.uShadowEnabled.value =
		light.castShadow && shadowMap ? 1 : 0;
	(pitchSplatCache.uniforms.uShadowMap.value as THREE.Texture) =
		shadowMap?.texture ?? dummyShadowTexture;
	(pitchSplatCache.uniforms.uShadowMatrix.value as THREE.Matrix4).copy(
		light.shadow.matrix,
	);
}
