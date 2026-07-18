import * as THREE from "three";

import {
	GRASS_TEXTURE_REPEAT,
	GRASS_TILE_METERS,
	getGrassColorTexture,
	getGrassNormalTexture,
} from "./materials";
import {
	MAX_PITCH_LIGHTS,
	type StadiumLightingRig,
	samplePitchLightUniforms,
} from "./stadiumLighting";

/**
 * Murawa kępkowa — 4 krótkie płaty na instancję (to samo ~28k draw, brak dziur).
 */
const BLADES_PER_TUFT = 4;
const BLADE_WIDTH = 0.16;
const BLADE_HEIGHT = 0.18;
const BLADE_SPACING = 0.44;
const BLADE_BASE_Y = 0.02;
/** Stały budżet GPU — bez zwiększania liczby instancji. */
const MAX_BLADE_INSTANCES = 28_000;
const BLADE_HEIGHT_SEGMENTS = 3;
const PLACEMENT_JITTER = 0.1;

const _lightPositions = Array.from(
	{ length: MAX_PITCH_LIGHTS },
	() => new THREE.Vector3(),
);
const _lightColors = Array.from(
	{ length: MAX_PITCH_LIGHTS },
	() => new THREE.Color(),
);

/** Placeholder — WebGL wymaga zbindowanej tekstury przy sampler2D. */
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
};

function seededRandom(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0x1_0000_0000;
	};
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
): number {
	const halfBase = BLADE_WIDTH * 0.5;
	let vertCount = 0;

	for (let s = 0; s <= BLADE_HEIGHT_SEGMENTS; s++) {
		const t = s / BLADE_HEIGHT_SEGMENTS;
		const y = t * BLADE_HEIGHT;
		const halfW = halfBase * (1.0 - t * 0.85);
		const left = rotateXZ(-halfW, 0, yaw);
		const right = rotateXZ(halfW, 0, yaw);

		positions.push(left[0], y, left[1], right[0], y, right[1]);
		uvs.push(0, t, 1, t);
		vertCount += 2;
	}

	for (let s = 0; s < BLADE_HEIGHT_SEGMENTS; s++) {
		const i = vertexBase + s * 2;
		indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
	}

	return vertCount;
}

function createTuftGeometry(): THREE.BufferGeometry {
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	let vertexBase = 0;

	for (let b = 0; b < BLADES_PER_TUFT; b++) {
		const yaw = (b / BLADES_PER_TUFT) * Math.PI + (b % 2) * 0.22;
		const added = appendTuftBlade(positions, uvs, indices, vertexBase, yaw);
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
			varying vec2 vUv;
			varying vec3 vWorldPos;
			varying vec3 vWorldNormal;
			varying float vHeightFactor;
			varying float vNormalJitter;

			void main() {
				vUv = uv;
				vHeightFactor = clamp(uv.y, 0.0, 1.0);

				vec4 worldCenter = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
				vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
				vWorldPos = worldPos.xyz;

				float nhash = fract(sin(dot(worldCenter.xz, vec2(12.9898, 78.233))) * 43758.5453);
				float nhash2 = fract(sin(dot(worldCenter.xz, vec2(39.346, 11.135))) * 43758.5453);
				vNormalJitter = nhash;
				vec3 nJitter = vec3((nhash - 0.5) * 0.55, 0.0, (nhash2 - 0.5) * 0.55);
				vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal + nJitter);

				vec3 pos = position;
				float sway = sin(uTime * 1.3 + worldCenter.x * 0.17 + worldCenter.z * 0.14) * 0.008;
				sway += sin(uTime * 2.0 + worldCenter.x * 0.06 - worldCenter.z * 0.08) * 0.004;
				pos.x += sway * vHeightFactor * 1.6;
				pos.z += sway * vHeightFactor * 0.9;

				vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
				gl_Position = projectionMatrix * mvPosition;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform sampler2D uGrassMap;
			uniform sampler2D uNormalMap;
			uniform float uTileMeters;
			uniform float uTexRepeat;
			uniform float uLightCount;
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

			vec3 perturbNormal(vec2 _texUV, vec3 baseN) {
				float n1 = fract(sin(dot(vWorldPos.xyz, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
				float n2 = fract(sin(dot(vWorldPos.xyz, vec3(39.346, 11.135, 83.155))) * 43758.5453);
				vec3 micro = vec3((n1 - 0.5) * 0.65, (n2 - 0.5) * 0.45, (n1 * n2 - 0.25) * 0.35);
				return normalize(baseN + micro);
			}

			float evalPitchLights(vec3 n) {
				float lit = 0.0;
				vec3 norm = normalize(n + vec3(0.0, 0.35, 0.0));

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

				vec4 shadowCoord = shadowMatrix * vec4(vWorldPos + vec3(0.0, 0.025, 0.0), 1.0);
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
				float bias = 0.00075;
				float shadow = 0.0;
				vec2 texel = vec2(1.0 / 1024.0);

				for (int x = -1; x <= 1; x++) {
					for (int y = -1; y <= 1; y++) {
						vec2 offset = vec2(float(x), float(y)) * texel;
						float closest = texture2D(shadowMap, shadowCoord.xy + offset).r;
						shadow += currentDepth - bias > closest ? 0.0 : 1.0;
					}
				}
				return shadow / 9.0;
			}

			float evalPitchShadows() {
				float visibility = 1.0;

				for (int i = 0; i < ${MAX_PITCH_LIGHTS}; i++) {
					if (float(i) >= uLightCount) break;
					float lit;
					${pitchShadowSwitch}
					visibility = min(visibility, lit);
				}

				return mix(0.38, 1.0, visibility);
			}

			void main() {
				vec2 texUV = vWorldPos.xz / uTileMeters * uTexRepeat;
				vec3 turf = texture2D(uGrassMap, texUV).rgb;
				if (turf.r < 0.08 && turf.g < 0.08 && turf.b < 0.08) {
					turf = vec3(0.15, 0.42, 0.1);
				}

				vec3 bladeN = perturbNormal(texUV, vWorldNormal);

				vec3 colorBase = vec3(0.08, 0.24, 0.065);
				vec3 colorTip = vec3(0.22, 0.52, 0.11);
				vec3 bladeColor = mix(colorBase, colorTip, vHeightFactor);

				float ao = mix(0.5, 1.0, vHeightFactor);

				float pitchLit = evalPitchLights(bladeN);
				float bladeNoise = mix(0.82, 1.18, vNormalJitter);
				float direct = clamp(pitchLit * 0.22 * bladeNoise + 0.52, 0.0, 1.0);
				float shade = mix(0.45, 1.0, direct) * evalPitchShadows();

				vec3 finalColor = bladeColor * ao * shade;
				finalColor = mix(finalColor, turf * 0.45, 0.12 * vHeightFactor);

				float noise = fract(sin(dot(vWorldPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
				float macroNoise = fract(sin(dot(vWorldPos.xz * 0.31, vec2(39.346, 11.135))) * 43758.5453);
				float lightScatter = mix(0.72, 1.28, noise) * mix(0.88, 1.12, macroNoise);
				finalColor *= lightScatter;

				float edge = 1.0 - smoothstep(0.5, 1.0, abs(vUv.x - 0.5) * 2.0);
				if (vHeightFactor * edge < 0.05) discard;

				gl_FragColor = vec4(finalColor, 1.0);
			}
		`,
		side: THREE.DoubleSide,
		transparent: false,
		depthWrite: true,
		depthTest: true,
		polygonOffset: true,
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -1,
	});
}

function pointInPolygon(
	x: number,
	z: number,
	polygon: { x: number; z: number }[],
): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const xi = polygon[i].x;
		const zi = polygon[i].z;
		const xj = polygon[j].x;
		const zj = polygon[j].z;
		const intersect =
			zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

export function buildGrassBlades(
	minX: number,
	maxX: number,
	minZ: number,
	maxZ: number,
	polygon?: { x: number; z: number }[],
): GrassBladeField {
	const grassMap = getGrassColorTexture();
	const normalMap = getGrassNormalTexture();
	if (!grassMap || !normalMap) {
		throw new Error(
			"FlyBall: brak tekstur murawy — wywołaj grassMaterial() przed buildGrassBlades()",
		);
	}

	const rand = seededRandom(0x8a3c91);
	const positions: THREE.Vector3[] = [];
	const rowStep = BLADE_SPACING * 0.8660254;

	for (let row = 0; positions.length < MAX_BLADE_INSTANCES; row++) {
		const rowZ = minZ + row * rowStep;
		if (rowZ > maxZ) break;
		const rowOffset = (row & 1) * (BLADE_SPACING * 0.5);
		for (let col = 0; positions.length < MAX_BLADE_INSTANCES; col++) {
			const wx = minX + rowOffset + col * BLADE_SPACING;
			if (wx > maxX) break;
			const jitterX = (rand() - 0.5) * PLACEMENT_JITTER;
			const jitterZ = (rand() - 0.5) * PLACEMENT_JITTER;
			const px = wx + jitterX;
			const pz = rowZ + jitterZ;
			if (polygon && !pointInPolygon(px, pz, polygon)) continue;
			if (px * px + pz * pz < 11.5 * 11.5) continue;
			positions.push(new THREE.Vector3(px, BLADE_BASE_Y, pz));
		}
	}

	if (positions.length === 0) {
		throw new Error("FlyBall: brak instancji trawy");
	}

	const geometry = createTuftGeometry();
	const material = createBladeMaterial(grassMap, normalMap);
	const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
	mesh.name = "grassBlades";
	mesh.frustumCulled = false;
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.renderOrder = 3;

	const matrix = new THREE.Matrix4();
	const quat = new THREE.Quaternion();
	const euler = new THREE.Euler();
	const scale = new THREE.Vector3(1, 1, 1);

	for (let i = 0; i < positions.length; i++) {
		const heightJitter = 0.94 + rand() * 0.12;
		const widthJitter = 0.92 + rand() * 0.16;
		euler.set(0, rand() * Math.PI * 2, 0);
		quat.setFromEuler(euler);
		scale.set(widthJitter, heightJitter, widthJitter);
		matrix.compose(positions[i], quat, scale);
		mesh.setMatrixAt(i, matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;

	return { mesh, material };
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
	field.material.uniforms.uLightCount.value = count;

	for (let i = 0; i < count; i++) {
		const light = rig.pitchLights[i];
		(
			field.material.uniforms[`uLightPos${i}`] as THREE.IUniform<THREE.Vector3>
		).value.copy(_lightPositions[i]);
		(
			field.material.uniforms[`uLightColor${i}`] as THREE.IUniform<THREE.Color>
		).value.copy(_lightColors[i]);
		(
			field.material.uniforms[`uLightWeight${i}`] as THREE.IUniform<number>
		).value = weights[i];

		const shadowMap = light.shadow.map;
		(
			field.material.uniforms[`uShadowEnabled${i}`] as THREE.IUniform<number>
		).value = light.castShadow && shadowMap ? 1 : 0;
		(
			field.material.uniforms[
				`uShadowMap${i}`
			] as THREE.IUniform<THREE.Texture | null>
		).value = shadowMap?.texture ?? dummyShadowTexture;
		(
			field.material.uniforms[
				`uShadowMatrix${i}`
			] as THREE.IUniform<THREE.Matrix4>
		).value.copy(light.shadow.matrix);
	}
}

export function updateGrassBlades(
	field: GrassBladeField | null,
	timeSec: number,
): void {
	if (!field) return;
	field.material.uniforms.uTime.value = timeSec;
}
