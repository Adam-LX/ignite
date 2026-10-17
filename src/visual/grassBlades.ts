import * as THREE from "three";

import { resolveBoostPadLayout } from "../arena/boostPadLayout";
import type { GraphicsQuality } from "../util/graphicsProfile";
import { resolveGraphicsSettings } from "../util/graphicsProfile";
import {
	getArenaPerimeterVertices,
	PLAYFIELD_SURFACE_Y,
	RL_ARENA,
} from "./arenaConstants";
import {
	GRASS_TEXTURE_REPEAT,
	GRASS_TILE_METERS,
	ensureGrassBladeTextures,
	getGrassColorTexture,
	getGrassNormalTexture,
	setPitchFloorBladeCarpetMode,
} from "./materials";
import {
	MAX_PITCH_LIGHTS,
	type StadiumLightingRig,
	samplePitchLightUniforms,
} from "./stadiumLighting";

/**
 * Gęsty dywan źdźbeł wokół kamery (look RL).
 * Flat pitch zostaje daleko; blisko — carpet bez „igieł na podłodze”.
 */
const BLADE_WIDTH = 0.055;
const BLADE_HEIGHT = 0.11;
const BLADE_HEIGHT_SEGMENTS = 5;
const BLADE_BASE_Y = PLAYFIELD_SURFACE_Y + 0.002;

const CENTER_CLEAR_R = 10.2;
const MIDLINE_CLEAR_X = 0.38;
const SIDELINE_CLEAR = 0.35;
const GOAL_BOX_CLEAR_Z = 14.5;
const GOAL_BOX_CLEAR_X = 13.5;

/**
 * Seed world-space → overlap stabilny; rebuild rzadko (częsty = hitch).
 * LOD fade goni kamerę co klatkę — bez „doczytywania” przy refillu.
 */
/** Większy próg = rzadziej pełny refill (hitch CPU przy Free Cam). */
const PATCH_REBUILD_M = 13.5;

type QualityBladeBudget = {
	spacing: number;
	maxInstances: number;
	bladesPerTuft: number;
	patchRadius: number;
};

const QUALITY_BUDGET: Record<GraphicsQuality, QualityBladeBudget | null> = {
	low: null,
	high: {
		/** 72k + jupiter SM = wielosekundowy freeze przy GRAJ. */
		spacing: 0.082,
		maxInstances: 52_000,
		bladesPerTuft: 8,
		patchRadius: 14,
	},
	medium: {
		spacing: 0.095,
		maxInstances: 36_000,
		bladesPerTuft: 7,
		patchRadius: 12,
	},
	deck: {
		spacing: 0.105,
		maxInstances: 28_000,
		bladesPerTuft: 6,
		patchRadius: 10,
	},
};

const _lightPositions = Array.from(
	{ length: MAX_PITCH_LIGHTS },
	() => new THREE.Vector3(),
);
const _lightColors = Array.from(
	{ length: MAX_PITCH_LIGHTS },
	() => new THREE.Color(),
);
const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _zeroScale = new THREE.Vector3(0, 0, 0);

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

function buildIndexedSwitch(
	count: number,
	builder: (index: number) => string,
): string {
	const lines: string[] = [];
	for (let i = 0; i < count; i++) {
		const kw = i === 0 ? "if" : "else if";
		lines.push(`${kw} (i == ${i}) { ${builder(i)} }`);
	}
	return lines.join("\n\t\t\t\t\t");
}

export type GrassBladeField = {
	mesh: THREE.InstancedMesh;
	material: THREE.ShaderMaterial;
	quality: GraphicsQuality;
	budget: QualityBladeBudget;
	polygon: { x: number; z: number }[];
	padClear: { x: number; z: number; r2: number }[];
	/** Centrum ostatniego refillu (instancje). */
	lastCamX: number;
	lastCamZ: number;
	/** Wygładzone centrum LOD — fade jedzie za kamerą bez skoków. */
	lodX: number;
	lodZ: number;
	lastTimeSec: number;
	activeCount: number;
};

function seededRandom(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0x1_0000_0000;
	};
}

/** Deterministyczny RNG komórki świata — refill nie przetasowuje overlapu. */
function cellRandom(ix: number, iz: number): () => number {
	return seededRandom(
		((ix * 73856093) ^ (iz * 19349663) ^ 0xa24baed5) >>> 0,
	);
}

function rotateXZ(x: number, z: number, angle: number): [number, number] {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return [x * c - z * s, x * s + z * c];
}

function appendTuftBlade(
	positions: number[],
	uvs: number[],
	indices: number[],
	vertexBase: number,
	yaw: number,
	lean: number,
	heightScale: number,
	widthScale: number,
	ox: number,
	oz: number,
): number {
	const halfBase = BLADE_WIDTH * 0.5 * widthScale;
	const height = BLADE_HEIGHT * heightScale;
	let vertCount = 0;

	for (let s = 0; s <= BLADE_HEIGHT_SEGMENTS; s++) {
		const t = s / BLADE_HEIGHT_SEGMENTS;
		const y = t * height;
		const halfW = halfBase * (1.0 - t * 0.9);
		const bend = lean * t * t;
		const left = rotateXZ(-halfW + bend, 0, yaw);
		const right = rotateXZ(halfW + bend, 0, yaw);

		positions.push(
			left[0] + ox,
			y,
			left[1] + oz,
			right[0] + ox,
			y,
			right[1] + oz,
		);
		uvs.push(0, t, 1, t);
		vertCount += 2;
	}

	for (let s = 0; s < BLADE_HEIGHT_SEGMENTS; s++) {
		const i = vertexBase + s * 2;
		indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
	}

	return vertCount;
}

function createTuftGeometry(
	rand: () => number,
	bladesPerTuft: number,
): THREE.BufferGeometry {
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	let vertexBase = 0;

	/** Kępka — źdźbła lekko rozsunięte (nie jeden stempel). */
	for (let b = 0; b < bladesPerTuft; b++) {
		const yaw =
			(b / bladesPerTuft) * Math.PI * 2 +
			(rand() - 0.5) * 0.7 +
			(b % 2) * 0.25;
		const lean = (rand() - 0.5) * 0.09;
		const heightScale = 0.65 + rand() * 0.7;
		const widthScale = 0.75 + rand() * 0.7;
		const ox = (rand() - 0.5) * 0.05;
		const oz = (rand() - 0.5) * 0.05;
		const added = appendTuftBlade(
			positions,
			uvs,
			indices,
			vertexBase,
			yaw,
			lean,
			heightScale,
			widthScale,
			ox,
			oz,
		);
		vertexBase += added;
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute(
		"position",
		new THREE.BufferAttribute(new Float32Array(positions), 3),
	);
	geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
	geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
	geo.computeVertexNormals();
	return geo;
}

function createBladeMaterial(
	grassMap: THREE.Texture,
	normalMap: THREE.Texture,
): THREE.ShaderMaterial {
	const lightPosUniforms: Record<string, THREE.IUniform<THREE.Vector3>> = {};
	const lightColorUniforms: Record<string, THREE.IUniform<THREE.Color>> = {};
	const lightWeightUniforms: Record<string, THREE.IUniform<number>> = {};
	const shadowMapUniforms: Record<
		string,
		THREE.IUniform<THREE.Texture | null>
	> = {};
	const shadowMatrixUniforms: Record<
		string,
		THREE.IUniform<THREE.Matrix4>
	> = {};
	const shadowEnabledUniforms: Record<string, THREE.IUniform<number>> = {};

	for (let i = 0; i < MAX_PITCH_LIGHTS; i++) {
		lightPosUniforms[`uLightPos${i}`] = { value: new THREE.Vector3() };
		lightColorUniforms[`uLightColor${i}`] = { value: new THREE.Color() };
		lightWeightUniforms[`uLightWeight${i}`] = { value: 0 };
		shadowMapUniforms[`uShadowMap${i}`] = { value: dummyShadowTexture };
		shadowMatrixUniforms[`uShadowMatrix${i}`] = { value: new THREE.Matrix4() };
		shadowEnabledUniforms[`uShadowEnabled${i}`] = { value: 0 };
	}

	const lightPosGlsl = Array.from(
		{ length: MAX_PITCH_LIGHTS },
		(_, i) => `uLightPos${i}`,
	).join(", ");
	const lightColorGlsl = Array.from(
		{ length: MAX_PITCH_LIGHTS },
		(_, i) => `uLightColor${i}`,
	).join(", ");
	const lightWeightGlsl = Array.from(
		{ length: MAX_PITCH_LIGHTS },
		(_, i) => `uLightWeight${i}`,
	).join(", ");
	const shadowMapGlsl = Array.from(
		{ length: MAX_PITCH_LIGHTS },
		(_, i) => `uShadowMap${i}`,
	).join(", ");
	const shadowMatrixGlsl = Array.from(
		{ length: MAX_PITCH_LIGHTS },
		(_, i) => `uShadowMatrix${i}`,
	).join(", ");
	const shadowEnabledGlsl = Array.from(
		{ length: MAX_PITCH_LIGHTS },
		(_, i) => `uShadowEnabled${i}`,
	).join(", ");

	const pitchLightSwitch = buildIndexedSwitch(
		MAX_PITCH_LIGHTS,
		(i) =>
			`toLight = uLightPos${i} - vWorldPos; lightCol = uLightColor${i}; weight = uLightWeight${i};`,
	);
	const pitchShadowSwitch = buildIndexedSwitch(
		MAX_PITCH_LIGHTS,
		(i) =>
			`lit = sampleJupiterShadow(uShadowMap${i}, uShadowMatrix${i}, uShadowEnabled${i});`,
	);

	return new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uCameraPos: { value: new THREE.Vector3() },
			uPatchRadius: { value: 16 },
			/** Free Cam / wysoko — chowaj dywan (klip: kwadratowa „łata”). */
			uCamHeightFade: { value: 1 },
			uGrassMap: { value: grassMap },
			uNormalMap: { value: normalMap },
			uTileMeters: { value: GRASS_TILE_METERS },
			uTexRepeat: { value: GRASS_TEXTURE_REPEAT },
			uLightCount: { value: 0.0 },
			...lightPosUniforms,
			...lightColorUniforms,
			...lightWeightUniforms,
			...shadowMapUniforms,
			...shadowMatrixUniforms,
			...shadowEnabledUniforms,
		},
		vertexShader: /* glsl */ `
			uniform float uTime;
			uniform vec3 uCameraPos;
			uniform float uPatchRadius;
			uniform float uCamHeightFade;
			varying vec2 vUv;
			varying vec3 vWorldPos;
			varying vec3 vWorldNormal;
			varying float vHeightFactor;
			varying float vNormalJitter;
			varying float vLod;

			void main() {
				vUv = uv;
				vHeightFactor = clamp(uv.y, 0.0, 1.0);

				vec4 worldCenter = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
				float camDist = length(worldCenter.xz - uCameraPos.xz);
				/**
				 * Bardzo miękki brim — bez kwadratowej wyspy przy Free Cam.
				 * Gęstość spada długo przed limitem patcha.
				 */
				float fade = 1.0 - smoothstep(uPatchRadius * 0.02, uPatchRadius * 0.72, camDist);
				vLod = fade * fade * fade * uCamHeightFade;

				vec3 pos = position;
				pos.y *= max(vLod, 0.001);

				float nhash = fract(sin(dot(worldCenter.xz, vec2(12.9898, 78.233))) * 43758.5453);
				float nhash2 = fract(sin(dot(worldCenter.xz, vec2(39.346, 11.135))) * 43758.5453);
				vNormalJitter = nhash;
				vec3 nJitter = vec3((nhash - 0.5) * 0.4, 0.0, (nhash2 - 0.5) * 0.4);
				vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal + nJitter);

				float sway = sin(uTime * 1.4 + worldCenter.x * 0.25 + worldCenter.z * 0.19) * 0.012;
				sway += sin(uTime * 2.2 + worldCenter.x * 0.09 - worldCenter.z * 0.13) * 0.006;
				pos.x += sway * vHeightFactor * 1.6 * vLod;
				pos.z += sway * vHeightFactor * 1.0 * vLod;

				vec4 worldPos = modelMatrix * instanceMatrix * vec4(pos, 1.0);
				vWorldPos = worldPos.xyz;

				vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
				gl_Position = projectionMatrix * mvPosition;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform sampler2D uGrassMap;
			uniform float uTileMeters;
			uniform float uTexRepeat;
			uniform float uLightCount;
			uniform vec3 uCameraPos;
			uniform vec3 ${lightPosGlsl};
			uniform vec3 ${lightColorGlsl};
			uniform float ${lightWeightGlsl};
			uniform sampler2D ${shadowMapGlsl};
			uniform mat4 ${shadowMatrixGlsl};
			uniform float ${shadowEnabledGlsl};

			varying vec2 vUv;
			varying vec3 vWorldPos;
			varying vec3 vWorldNormal;
			varying float vHeightFactor;
			varying float vNormalJitter;
			varying float vLod;

			float evalPitchLights(vec3 n) {
				float lit = 0.0;
				vec3 norm = normalize(n + vec3(0.0, 0.4, 0.0));

				for (int i = 0; i < ${MAX_PITCH_LIGHTS}; i++) {
					if (float(i) >= uLightCount) break;
					vec3 toLight;
					vec3 lightCol;
					float weight;
					${pitchLightSwitch}

					float dist = length(toLight);
					float falloff = 1.0 / (1.0 + dist * dist * 0.00008);
					float ndl = max(0.0, dot(norm, normalize(toLight)));
					lit += ndl * falloff * weight * (0.55 + 0.45 * dot(lightCol, vec3(0.33)));
				}
				return lit;
			}

			float sampleJupiterShadow(sampler2D shadowMap, mat4 shadowMatrix, float enabled) {
				if (enabled < 0.5) return 1.0;

				vec4 shadowCoord = shadowMatrix * vec4(vWorldPos + vec3(0.0, 0.02, 0.0), 1.0);
				shadowCoord.xyz /= shadowCoord.w;
				shadowCoord.xyz = shadowCoord.xyz * 0.5 + 0.5;

				if (
					shadowCoord.x < 0.0 || shadowCoord.x > 1.0 ||
					shadowCoord.y < 0.0 || shadowCoord.y > 1.0 ||
					shadowCoord.z > 1.0
				) {
					return 1.0;
				}

				float currentDepth = shadowCoord.z;
				float bias = 0.0012;
				float shadow = 0.0;
				/** Szerszy kernel — mniej pikselowych plam na źdźbłach. */
				vec2 texel = vec2(1.0 / 1024.0) * 2.4;

				for (int x = -2; x <= 2; x++) {
					for (int y = -2; y <= 2; y++) {
						vec2 offset = vec2(float(x), float(y)) * texel;
						float closest = texture2D(shadowMap, shadowCoord.xy + offset).r;
						shadow += currentDepth - bias > closest ? 0.0 : 1.0;
					}
				}
				return shadow / 25.0;
			}

			float evalPitchShadows() {
				float visibility = 1.0;

				for (int i = 0; i < ${MAX_PITCH_LIGHTS}; i++) {
					if (float(i) >= uLightCount) break;
					float lit;
					${pitchShadowSwitch}
					visibility = min(visibility, lit);
				}

				/** Mocny lift — SM na źdźbłach tylko delikatny ton, nie czarne pola. */
				return mix(0.9, 1.0, visibility);
			}

			void main() {
				if (vLod < 0.05) discard;

				vec2 texUV = vWorldPos.xz / uTileMeters * uTexRepeat;
				vec3 turf = texture2D(uGrassMap, texUV).rgb;
				if (turf.r < 0.08 && turf.g < 0.08 && turf.b < 0.08) {
					turf = vec3(0.14, 0.38, 0.09);
				}

				/** Tip ≈ flat pitch — bez jasnej bańki vs muted turf. */
				vec3 colorBase = vec3(0.07, 0.16, 0.055);
				vec3 colorMid = vec3(0.11, 0.26, 0.075);
				vec3 colorTip = vec3(0.15, 0.32, 0.09);
				vec3 bladeColor = mix(colorBase, colorMid, smoothstep(0.0, 0.5, vHeightFactor));
				bladeColor = mix(bladeColor, colorTip, smoothstep(0.4, 1.0, vHeightFactor));
				float turfBlend = mix(0.55, 0.96, 1.0 - vLod);
				bladeColor = mix(bladeColor, turf, turfBlend);

				float ao = mix(0.42, 1.0, pow(vHeightFactor, 0.55));
				float pitchLit = evalPitchLights(vWorldNormal);
				float bladeNoise = mix(0.9, 1.08, vNormalJitter);
				/** Spec tylko blisko kamery — nie podbija całego kręgu. */
				float tipSpec = pow(vHeightFactor, 2.4) * 0.14 * vLod * vLod;
				/** Mniej stałego fillu — widać plamy jupiterów na dywanie. */
				float direct = clamp(pitchLit * 0.32 * bladeNoise + 0.22 + tipSpec, 0.0, 1.25);
				float shade = mix(0.45, 1.08, direct) * evalPitchShadows();
				/** Zewnętrzny brim → luminance flat pitch (mniej „łaty”). */
				shade = mix(shade, 0.74, 1.0 - vLod);

				vec3 finalColor = bladeColor * ao * shade;
				finalColor += turf * tipSpec * 0.15;

				/** Rim od jupiterów na końcówkach — premium sparkle na dywanie. */
				vec3 viewDir = normalize(uCameraPos - vWorldPos);
				float rim = pow(1.0 - max(0.0, dot(normalize(vWorldNormal), viewDir)), 2.6);
				float rimLit = evalPitchLights(normalize(vWorldNormal + viewDir * 0.3));
				finalColor += vec3(0.06, 0.12, 0.04) * rim * rimLit * vLod * vHeightFactor * 0.42;

				float edge = 1.0 - smoothstep(0.32, 1.0, abs(vUv.x - 0.5) * 2.0);
				float alpha = edge * smoothstep(0.01, 0.12, vHeightFactor) *
					(1.0 - smoothstep(0.82, 1.0, vHeightFactor) * 0.28) * vLod;
				if (alpha < 0.035) discard;

				gl_FragColor = vec4(finalColor, alpha);
			}
		`,
		side: THREE.DoubleSide,
		transparent: true,
		depthWrite: false,
		depthTest: true,
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
	});
}

function pointInPolygon(
	x: number,
	z: number,
	polygon: { x: number; z: number }[],
): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const xi = polygon[i]!.x;
		const zi = polygon[i]!.z;
		const xj = polygon[j]!.x;
		const zj = polygon[j]!.z;
		const intersect =
			zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

function blocksPitchMarkings(x: number, z: number): boolean {
	const halfW = RL_ARENA.HALF_WIDTH;
	const halfL = RL_ARENA.HALF_LENGTH;
	if (halfW - Math.abs(x) < SIDELINE_CLEAR) return true;
	if (halfL - Math.abs(z) < SIDELINE_CLEAR) return true;
	if (x * x + z * z < CENTER_CLEAR_R * CENTER_CLEAR_R) return true;
	if (Math.abs(x) < MIDLINE_CLEAR_X) return true;
	if (
		Math.abs(z) > halfL - GOAL_BOX_CLEAR_Z &&
		Math.abs(x) < GOAL_BOX_CLEAR_X
	) {
		return true;
	}
	return false;
}

function hideInstance(mesh: THREE.InstancedMesh, index: number): void {
	_matrix.compose(_pos.set(0, -10, 0), _quat.identity(), _zeroScale);
	mesh.setMatrixAt(index, _matrix);
}

function writeTuftInstance(
	mesh: THREE.InstancedMesh,
	index: number,
	px: number,
	pz: number,
	rand: () => number,
): void {
	const heightJitter = 0.78 + rand() * 0.5;
	const widthJitter = 0.85 + rand() * 0.45;
	_euler.set((rand() - 0.5) * 0.14, rand() * Math.PI * 2, (rand() - 0.5) * 0.14);
	_quat.setFromEuler(_euler);
	_scale.set(widthJitter, heightJitter, widthJitter);
	_pos.set(px, BLADE_BASE_Y, pz);
	_matrix.compose(_pos, _quat, _scale);
	mesh.setMatrixAt(index, _matrix);
}

function refillPatch(field: GrassBladeField, camX: number, camZ: number): void {
	const { mesh, budget, polygon, padClear } = field;
	const spacing = budget.spacing;
	const r = budget.patchRadius;
	const r2 = r * r;
	const jitter = spacing * 0.55;

	let count = 0;
	const max = budget.maxInstances;
	const originX = Math.floor((camX - r) / spacing) * spacing;
	const originZ = Math.floor((camZ - r) / spacing) * spacing;
	let row = 0;

	for (let gz = originZ; gz <= camZ + r; gz += spacing) {
		const rowOff = (row % 2) * spacing * 0.5;
		row++;
		const iz = Math.round(gz / spacing);
		for (let gx = originX; gx <= camX + r; gx += spacing) {
			if (count >= max) break;

			const ix = Math.round(gx / spacing);
			const rand = cellRandom(ix, iz);
			const px = gx + rowOff + (rand() - 0.5) * jitter;
			const pz = gz + (rand() - 0.5) * jitter;
			const dx = px - camX;
			const dz = pz - camZ;
			if (dx * dx + dz * dz > r2) continue;
			if (!pointInPolygon(px, pz, polygon)) continue;
			if (blocksPitchMarkings(px, pz)) continue;

			let onPad = false;
			for (const pad of padClear) {
				const pdx = px - pad.x;
				const pdz = pz - pad.z;
				if (pdx * pdx + pdz * pdz < pad.r2) {
					onPad = true;
					break;
				}
			}
			if (onPad) continue;

			writeTuftInstance(mesh, count, px, pz, rand);
			count++;
		}
		if (count >= max) break;
	}

	for (let i = count; i < max; i++) {
		hideInstance(mesh, i);
	}

	mesh.count = count;
	mesh.instanceMatrix.needsUpdate = true;
	mesh.computeBoundingSphere();
	if (mesh.boundingSphere) {
		mesh.boundingSphere.center.set(camX, BLADE_BASE_Y, camZ);
		mesh.boundingSphere.radius = r + 2;
	}

	field.activeCount = count;
	field.lastCamX = camX;
	field.lastCamZ = camZ;
	field.material.uniforms.uPatchRadius!.value = budget.patchRadius;
}

export function disposeGrassBlades(field: GrassBladeField | null): void {
	if (!field) return;
	field.mesh.removeFromParent();
	field.mesh.geometry.dispose();
	field.material.dispose();
	setPitchFloorBladeCarpetMode(false);
}

/**
 * Alokuje pool instancji; dywan wypełnia się wokół kamery w updateGrassBlades.
 */
export function buildGrassBlades(
	quality: GraphicsQuality = resolveGraphicsSettings().quality,
	polygon: { x: number; z: number }[] = getArenaPerimeterVertices(),
): GrassBladeField | null {
	const budget = QUALITY_BUDGET[quality];
	if (!budget) {
		setPitchFloorBladeCarpetMode(false);
		return null;
	}

	ensureGrassBladeTextures();
	const grassMap = getGrassColorTexture();
	const normalMap = getGrassNormalTexture();
	if (!grassMap || !normalMap) {
		console.warn("FlyBall: brak tekstur murawy — źdźbła skip");
		return null;
	}

	const rand = seededRandom(0xc4f91a2 ^ (quality.length * 0x9e37));
	const geometry = createTuftGeometry(rand, budget.bladesPerTuft);
	const material = createBladeMaterial(grassMap, normalMap);
	material.uniforms.uPatchRadius!.value = budget.patchRadius;

	const mesh = new THREE.InstancedMesh(geometry, material, budget.maxInstances);
	mesh.name = "grassBlades";
	mesh.frustumCulled = true;
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.renderOrder = 1;
	mesh.count = 0;

	for (let i = 0; i < budget.maxInstances; i++) {
		hideInstance(mesh, i);
	}
	mesh.instanceMatrix.needsUpdate = true;

	const padClear = resolveBoostPadLayout().map((p) => ({
		x: p.x,
		z: p.z,
		r2: (p.big ? 2.15 : 0.85) ** 2,
	}));

	setPitchFloorBladeCarpetMode(true);

	const field: GrassBladeField = {
		mesh,
		material,
		quality,
		budget,
		polygon: polygon.slice(),
		padClear,
		lastCamX: Number.NaN,
		lastCamZ: Number.NaN,
		lodX: Number.NaN,
		lodZ: Number.NaN,
		lastTimeSec: 0,
		activeCount: 0,
	};

	/** Kickoff: wypełnij wokół środka boiska. */
	refillPatch(field, 0, 0);
	return field;
}

export function syncGrassBladeLighting(
	field: GrassBladeField | null,
	rig: StadiumLightingRig,
): void {
	if (!field) return;

	const weights: number[] = [];
	const count = samplePitchLightUniforms(
		rig,
		_lightPositions,
		_lightColors,
		weights,
	);
	field.material.uniforms.uLightCount!.value = count;

	for (let i = 0; i < MAX_PITCH_LIGHTS; i++) {
		(
			field.material.uniforms[`uLightPos${i}`] as THREE.IUniform<THREE.Vector3>
		).value.copy(_lightPositions[i]!);
		(
			field.material.uniforms[`uLightColor${i}`] as THREE.IUniform<THREE.Color>
		).value.copy(_lightColors[i]!);
		(
			field.material.uniforms[`uLightWeight${i}`] as THREE.IUniform<number>
		).value = i < count ? (weights[i] ?? 0) : 0;

		/**
		 * Nie wiąż Jupiter SM do źdźbeł — multi-SM + bias = czarne plamy na murawie.
		 */
		(
			field.material.uniforms[`uShadowEnabled${i}`] as THREE.IUniform<number>
		).value = 0;
		(
			field.material.uniforms[
				`uShadowMap${i}`
			] as THREE.IUniform<THREE.Texture | null>
		).value = dummyShadowTexture;
	}
}

export function updateGrassBlades(
	field: GrassBladeField | null,
	timeSec: number,
	cameraPos?: THREE.Vector3,
): void {
	if (!field) return;
	field.material.uniforms.uTime!.value = timeSec;
	if (!cameraPos) return;

	const dt = Math.min(
		0.05,
		Math.max(0, timeSec - (field.lastTimeSec || timeSec)),
	);
	field.lastTimeSec = timeSec;

	/** LOD center goni kamerę — fade jest dynamiczny, bez skoku przy refillu. */
	if (!Number.isFinite(field.lodX) || !Number.isFinite(field.lodZ)) {
		field.lodX = cameraPos.x;
		field.lodZ = cameraPos.z;
	} else {
		const follow = 1 - Math.exp(-10 * Math.max(dt, 1 / 120));
		field.lodX += (cameraPos.x - field.lodX) * follow;
		field.lodZ += (cameraPos.z - field.lodZ) * follow;
	}

	(
		field.material.uniforms.uCameraPos as THREE.IUniform<THREE.Vector3>
	).value.set(field.lodX, cameraPos.y, field.lodZ);

	/** Chase ~3–8 m; Free Cam 20+ m → chowaj dywan (widać kwadratową łatę). */
	const heightFade = THREE.MathUtils.smoothstep(32, 11, cameraPos.y);
	field.material.uniforms.uCamHeightFade!.value = heightFade;
	field.mesh.visible = heightFade > 0.04;

	const dx = cameraPos.x - field.lastCamX;
	const dz = cameraPos.z - field.lastCamZ;
	if (
		!Number.isFinite(field.lastCamX) ||
		dx * dx + dz * dz > PATCH_REBUILD_M * PATCH_REBUILD_M
	) {
		refillPatch(field, cameraPos.x, cameraPos.z);
	}
}
