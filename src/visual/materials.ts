import * as THREE from "three";

import { assetUrl } from "../util/assetUrl";
import { installGrassMowPattern } from "./grassMowPattern";
import {
	getCachedMeshyTexture,
	getMeshyArenaManifest,
	resolveMeshyTexture,
} from "./meshyArenaAssets";
import { createNeonWallMaterial, neonCeilingHexMaterial } from "./neonWallMaterial";
import { isPathTraceLookEnabled } from "../util/presentationPrefs";

export const RL = {
	wall: 0x1a3560,
	wallTop: 0x6ec8ff,
	wallGlow: 0x9adcff,
	goalBlue: 0x2d8fff,
	goalOrange: 0xff8c28,
	ball: 0xff6a00,
	ballGlow: 0xffaa44,
	carBlue: 0x0044ff,
	carAccent: 0xffe040,
	crowd: 0x0a1020,
} as const;

/** Metry na jeden kafel tekstury murawy (UV = pozycja świata / ta wartość). */
export const GRASS_TILE_METERS = 7.5;
/** Powtórzenia w UV — 1 przy fotorealistycznej teksturze (UV już w metrach świata). */
export const GRASS_TEXTURE_REPEAT = 1;

let grassRenderer: THREE.WebGLRenderer | null = null;
let grassMaterialCache: THREE.MeshStandardMaterial | null = null;
let pitchFloorMaterialCache: THREE.MeshStandardMaterial | null = null;
/** Gdy dywan źdźbeł ON — mniej plastycznego clearcoat na flat pitch. */
let pitchBladeCarpetMode = false;
let grassColorTexture: THREE.Texture | null = null;
let grassNormalTexture: THREE.Texture | null = null;
let pitchDetailRoughnessTexture: THREE.Texture | null = null;
let pitchDetailNoiseTexture: THREE.Texture | null = null;
let proceduralBumpTexture: THREE.Texture | null = null;
let ballMaterialCache: THREE.MeshPhysicalMaterial | null = null;
let ballAlbedoTexture: THREE.Texture | null = null;

/** EmissiveIntensity — scena niesie diffuse; to tylko rim/neon punch. */
const BALL_EMISSIVE_BASE = 0.52;
const BALL_HIT_FLASH_PEAK = 2.4;
const BALL_HIT_FLASH_DECAY = 4.5;
let ballHitFlash = BALL_EMISSIVE_BASE;

const BALL_ALBEDO_URL = assetUrl("/assets/textures/ball_cyber_albedo.jpg");
const BALL_ALBEDO_FALLBACK_URL = assetUrl(
	"/assets/textures/ball_cyber_albedo.png",
);

function configureBallTexture(tex: THREE.Texture): void {
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.anisotropy = grassRenderer?.capabilities.getMaxAnisotropy() ?? 16;
	tex.needsUpdate = true;
}

function onBallAlbedoLoaded(tex: THREE.Texture): void {
	configureBallTexture(tex);
	if (ballMaterialCache) {
		ballMaterialCache.map = tex;
		ballMaterialCache.needsUpdate = true;
	}
}

function getBallAlbedoUrl(): string {
	if (getMeshyArenaManifest()?.ballAlbedo) {
		return resolveMeshyTexture(
			"ballAlbedo",
			"/assets/textures/ball_cyber_albedo.jpg",
		);
	}
	return BALL_ALBEDO_URL;
}

function getBallAlbedoTexture(): THREE.Texture {
	if (ballAlbedoTexture) return ballAlbedoTexture;

	const loader = new THREE.TextureLoader();
	ballAlbedoTexture = loader.load(
		getBallAlbedoUrl(),
		onBallAlbedoLoaded,
		undefined,
		() => {
			ballAlbedoTexture?.dispose();
			ballAlbedoTexture = loader.load(
				BALL_ALBEDO_FALLBACK_URL,
				onBallAlbedoLoaded,
			);
		},
	);
	configureBallTexture(ballAlbedoTexture);
	return ballAlbedoTexture;
}

/** Proceduralny szum Perlin-like — maskuje powtarzalność albedo na murawie boiska. */
function getPitchDetailNoiseTexture(): THREE.Texture {
	if (pitchDetailNoiseTexture) return pitchDetailNoiseTexture;

	const size = 512;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		const fallback = new THREE.DataTexture(
			new Uint8Array(size * size).fill(128),
			size,
			size,
			THREE.RedFormat,
		);
		fallback.needsUpdate = true;
		pitchDetailNoiseTexture = fallback;
		return fallback;
	}

	const image = ctx.createImageData(size, size);
	const perm = new Uint8Array(512);
	for (let i = 0; i < 256; i++) perm[i] = i;
	for (let i = 255; i > 0; i--) {
		const j = (Math.random() * (i + 1)) | 0;
		[perm[i], perm[j]] = [perm[j], perm[i]];
	}
	for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

	const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	const lerp = (a: number, b: number, t: number) => a + t * (b - a);
	const grad = (hash: number, x: number, y: number) => {
		const h = hash & 3;
		const u = h < 2 ? x : y;
		const v = h < 2 ? y : x;
		return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
	};
	const noise2d = (x: number, y: number) => {
		const xi = Math.floor(x) & 255;
		const yi = Math.floor(y) & 255;
		const xf = x - Math.floor(x);
		const yf = y - Math.floor(y);
		const u = fade(xf);
		const v = fade(yf);
		const aa = perm[xi] + yi;
		const ab = perm[xi] + yi + 1;
		const ba = perm[xi + 1] + yi;
		const bb = perm[xi + 1] + yi + 1;
		return lerp(
			lerp(grad(perm[aa], xf, yf), grad(perm[ba], xf - 1, yf), u),
			lerp(grad(perm[ab], xf, yf - 1), grad(perm[bb], xf - 1, yf - 1), u),
			v,
		);
	};

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let v = 0;
			let amp = 1;
			let freq = 1 / 64;
			for (let o = 0; o < 5; o++) {
				v += noise2d(x * freq, y * freq) * amp;
				amp *= 0.5;
				freq *= 2.1;
			}
			const byte = Math.max(0, Math.min(255, (200 + (v * 0.5 + 0.5) * 55) | 0));
			const i = (y * size + x) * 4;
			image.data[i] = byte;
			image.data[i + 1] = byte;
			image.data[i + 2] = byte;
			image.data[i + 3] = 255;
		}
	}
	ctx.putImageData(image, 0, 0);

	pitchDetailNoiseTexture = new THREE.CanvasTexture(canvas);
	pitchDetailNoiseTexture.wrapS = THREE.RepeatWrapping;
	pitchDetailNoiseTexture.wrapT = THREE.RepeatWrapping;
	pitchDetailNoiseTexture.repeat.set(5.12, 3.84);
	pitchDetailNoiseTexture.minFilter = THREE.LinearMipmapLinearFilter;
	pitchDetailNoiseTexture.magFilter = THREE.LinearFilter;
	pitchDetailNoiseTexture.colorSpace = THREE.LinearSRGBColorSpace;
	pitchDetailNoiseTexture.anisotropy =
		grassRenderer?.capabilities.getMaxAnisotropy() ?? 16;
	pitchDetailNoiseTexture.needsUpdate = true;
	return pitchDetailNoiseTexture;
}

/** Proceduralna heightmapa 256×256 — mikro-szum pod bump mapping murawy i ramp. */
export function getProceduralBumpTexture(): THREE.Texture {
	if (proceduralBumpTexture) return proceduralBumpTexture;

	const size = 256;
	const data = new Uint8Array(size * size);
	for (let i = 0; i < data.length; i++) {
		data[i] = (Math.random() * 255) | 0;
	}

	if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext("2d");
		if (ctx) {
			const image = ctx.createImageData(size, size);
			for (let i = 0; i < image.data.length; i += 4) {
				const v = data[(i / 4) | 0];
				image.data[i] = v;
				image.data[i + 1] = v;
				image.data[i + 2] = v;
				image.data[i + 3] = 255;
			}
			ctx.putImageData(image, 0, 0);
			proceduralBumpTexture = new THREE.CanvasTexture(canvas);
		}
	}

	if (!proceduralBumpTexture) {
		const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat);
		tex.needsUpdate = true;
		proceduralBumpTexture = tex;
	}

	proceduralBumpTexture.wrapS = THREE.RepeatWrapping;
	proceduralBumpTexture.wrapT = THREE.RepeatWrapping;
	proceduralBumpTexture.repeat.set(12, 12);
	proceduralBumpTexture.colorSpace = THREE.LinearSRGBColorSpace;
	return proceduralBumpTexture;
}

function setupGrassMap(
	tex: THREE.Texture,
	colorSpace: THREE.ColorSpace,
	rotation = 0,
): void {
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set(GRASS_TEXTURE_REPEAT, GRASS_TEXTURE_REPEAT);
	tex.rotation = rotation;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.colorSpace = colorSpace;
	tex.anisotropy = grassRenderer?.capabilities.getMaxAnisotropy() ?? 16;
}

function setupPitchDetailMap(tex: THREE.Texture): void {
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	/** Gęstszy micro-detail na roughness/AO. */
	tex.repeat.set(8.4, 6.2);
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.colorSpace = THREE.LinearSRGBColorSpace;
	tex.anisotropy = grassRenderer?.capabilities.getMaxAnisotropy() ?? 16;
}

function applyGrassAnisotropy(): void {
	if (!grassRenderer || !grassMaterialCache) return;
	const max = grassRenderer.capabilities.getMaxAnisotropy();
	if (grassMaterialCache.map) grassMaterialCache.map.anisotropy = max;
}

export function getGrassColorTexture(): THREE.Texture | null {
	return grassColorTexture;
}

export function getGrassNormalTexture(): THREE.Texture | null {
	return grassNormalTexture;
}

/** Tekstury kafelkowe dla instancji źdźbeł 3D (niezależne od mapy podłogi). */
export function ensureGrassBladeTextures(): void {
	if (grassColorTexture && grassNormalTexture) return;
	grassMaterial();
}

export function grassMaterial(): THREE.MeshStandardMaterial {
	if (grassMaterialCache) return grassMaterialCache;

	const loader = new THREE.TextureLoader();
	const color = loader.load(assetUrl("/assets/textures/grass_color.jpg"));
	const normal = loader.load(assetUrl("/assets/textures/grass_normal.jpg"));

	grassColorTexture = color;
	grassNormalTexture = normal;
	setupGrassMap(color, THREE.SRGBColorSpace);
	setupGrassMap(normal, THREE.LinearSRGBColorSpace, 0.25);

	grassMaterialCache = new THREE.MeshStandardMaterial({
		map: color,
		roughness: 0.95,
		metalness: 0.05,
		normalMap: null,
		roughnessMap: null,
		displacementMap: null,
		bumpMap: null,
		color: 0xffffff,
		envMapIntensity: 0.04,
	});

	applyGrassAnisotropy();
	return grassMaterialCache;
}

/** Murawa boiska — grass_color + detail PBR. */
export function pitchFloorMaterial(): THREE.MeshStandardMaterial {
	if (pitchFloorMaterialCache) {
		return pitchFloorMaterialCache;
	}

	const manifest = getMeshyArenaManifest();
	const useMeshyGrass = !!manifest?.grassColor;
	const loader = new THREE.TextureLoader();
	const color = loader.load(
		resolveMeshyTexture("grassColor", "/assets/textures/grass_color.jpg"),
	);
	const normal = loader.load(
		resolveMeshyTexture("grassNormal", "/assets/textures/grass_normal.jpg"),
	);
	const detailRoughness = loader.load(
		resolveMeshyTexture(
			"grassRoughness",
			"/assets/textures/grass_roughness.jpg",
		),
	);
	const detailNoise = getPitchDetailNoiseTexture();

	grassColorTexture = color;
	grassNormalTexture = normal;
	pitchDetailRoughnessTexture = detailRoughness;
	setupGrassMap(color, THREE.SRGBColorSpace);
	if (!useMeshyGrass) {
		color.repeat.set(1.031, 0.967);
	}
	setupGrassMap(
		normal,
		THREE.LinearSRGBColorSpace,
		useMeshyGrass ? 0.18 : 0.31,
	);
	normal.repeat.copy(color.repeat);

	setupPitchDetailMap(detailRoughness);
	if (useMeshyGrass) {
		detailRoughness.repeat.copy(color.repeat);
		setupGrassMap(detailRoughness, THREE.LinearSRGBColorSpace, 1);
	}

	pitchFloorMaterialCache = new THREE.MeshPhysicalMaterial({
		name: "pitchFloorGrassDetail",
		map: color,
		normalMap: normal,
		normalScale: new THREE.Vector2(
			useMeshyGrass ? 2.35 : 2.05,
			useMeshyGrass ? 2.35 : 2.05,
		),
		roughnessMap: detailNoise,
		aoMap: useMeshyGrass ? detailRoughness : detailRoughness,
		aoMapIntensity: useMeshyGrass ? 0.38 : 0.34,
		metalness: 0,
		/** Stadium green — nie fluoro wash. */
		color: useMeshyGrass ? 0xa8c85a : 0xb0d060,
		roughness: useMeshyGrass ? 0.38 : 0.42,
		envMapIntensity: useMeshyGrass ? 0.95 : 0.9,
		clearcoat: 0.12,
		clearcoatRoughness: 0.42,
		reflectivity: 0.3,
	});

	/** Pasy koszenia zawsze — flat pitch AAA (bez meshów źdźbeł na boisku). */
	installGrassMowPattern(pitchFloorMaterialCache);
	applyPitchBladeCarpetModeToMaterial(pitchFloorMaterialCache);

	if (grassRenderer && pitchFloorMaterialCache.map) {
		pitchFloorMaterialCache.map.anisotropy =
			grassRenderer.capabilities.getMaxAnisotropy();
	}
	return pitchFloorMaterialCache;
}

/**
 * Dywan źdźbeł ON → matniejszy flat pitch (bez plastycznej fali specular między źdźbłami).
 */
export function setPitchFloorBladeCarpetMode(enabled: boolean): void {
	pitchBladeCarpetMode = enabled;
	if (pitchFloorMaterialCache) {
		applyPitchBladeCarpetModeToMaterial(pitchFloorMaterialCache);
	}
}

export function isPitchFloorBladeCarpetMode(): boolean {
	return pitchBladeCarpetMode;
}

function applyPitchBladeCarpetModeToMaterial(
	mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
): void {
	if (!(mat instanceof THREE.MeshPhysicalMaterial)) return;
	const pt = isPathTraceLookEnabled();
	if (pitchBladeCarpetMode) {
		/**
		 * Dywan źdźbeł.
		 * PT ON → mokry lustrzany clearcoat pod źdźbłami.
		 * PT OFF → matowy competitive.
		 */
		if (pt) {
			mat.clearcoat = 0.3;
			mat.clearcoatRoughness = 0.2;
			mat.roughness = 0.4;
			mat.envMapIntensity = 0.92;
			mat.normalScale.set(1.55, 1.55);
			mat.aoMapIntensity = 0.26;
			mat.color.setHex(0xb8d868);
		} else {
			mat.clearcoat = 0.06;
			mat.clearcoatRoughness = 0.65;
			mat.roughness = Math.max(mat.roughness, 0.72);
			mat.envMapIntensity = 0.42;
			mat.normalScale.set(1.2, 1.2);
			mat.aoMapIntensity = 0.3;
			mat.color.setHex(0xb0cc60);
		}
	} else if (pt) {
		mat.clearcoat = 0.32;
		mat.clearcoatRoughness = 0.16;
		mat.roughness = 0.34;
		mat.envMapIntensity = 0.98;
		mat.normalScale.set(1.6, 1.6);
		mat.aoMapIntensity = 0.24;
		mat.color.setHex(0xc0de70);
	} else {
		mat.clearcoat = 0.14;
		mat.clearcoatRoughness = 0.45;
		mat.roughness = 0.58;
		mat.envMapIntensity = 0.62;
		mat.normalScale.set(1.3, 1.3);
		mat.aoMapIntensity = 0.3;
		mat.color.setHex(0xb0cc60);
	}
}

/** Murawa boiska — alias dla refreshAllGrassTextures. */
export function pitchGrassMaterial(): THREE.MeshStandardMaterial {
	return pitchFloorMaterial();
}

export function createBallMaterial(): THREE.MeshPhysicalMaterial {
	if (ballMaterialCache) return ballMaterialCache;

	ballMaterialCache = new THREE.MeshPhysicalMaterial({
		color: 0xffffff,
		map: getBallAlbedoTexture(),
		metalness: 0.12,
		roughness: 0.2,
		clearcoat: 0.84,
		clearcoatRoughness: 0.075,
		sheen: 0.42,
		sheenRoughness: 0.22,
		sheenColor: new THREE.Color(0xa8f8ff),
		envMapIntensity: 1.55,
		/** Subtelny neon — czytelność bez zabijania mikrogeometrii PBR. */
		emissive: new THREE.Color(0x2a6a80),
		emissiveIntensity: BALL_EMISSIVE_BASE,
		toneMapped: true,
		fog: false,
	});
	ballHitFlash = BALL_EMISSIVE_BASE;
	return ballMaterialCache;
}

/** Rozbłysk neonu przy uderzeniu auta w piłkę. */
export function triggerBallHitFlash(intensity = 1.0): void {
	if (!ballMaterialCache) return;
	const peak = THREE.MathUtils.lerp(
		BALL_HIT_FLASH_PEAK,
		3.2,
		THREE.MathUtils.clamp(intensity, 0, 1),
	);
	ballHitFlash = Math.max(ballHitFlash, peak);
	ballMaterialCache.emissiveIntensity = ballHitFlash;
	ballMaterialCache.emissive.setRGB(0.12, 0.55, 0.85);
}

/** Płynne wygaszanie rozbłysku w trakcie lotu piłki. */
export function updateBallHitFlash(dt: number): void {
	if (!ballMaterialCache || dt <= 0) return;
	if (ballHitFlash <= BALL_EMISSIVE_BASE) return;
	ballHitFlash -= BALL_HIT_FLASH_DECAY * dt;
	if (ballHitFlash < BALL_EMISSIVE_BASE) ballHitFlash = BALL_EMISSIVE_BASE;
	ballMaterialCache.emissiveIntensity = ballHitFlash;
	if (ballHitFlash <= BALL_EMISSIVE_BASE + 0.02) {
		ballMaterialCache.emissive.setRGB(0.16, 0.42, 0.53);
	}
}

export function resetBallHitFlash(): void {
	if (!ballMaterialCache) return;
	ballHitFlash = BALL_EMISSIVE_BASE;
	ballMaterialCache.emissiveIntensity = BALL_EMISSIVE_BASE;
	ballMaterialCache.emissive.setRGB(0.16, 0.42, 0.53);
}

/** Upload tekstury piłki na GPU przed pierwszym kontaktem (unika hitch przy trafieniu). */
export function warmupBallGpuTexture(renderer: THREE.WebGLRenderer): void {
	renderer.initTexture(getBallAlbedoTexture());
}

/** @deprecated — zachowane dla kompatybilności wywołań z GameSession. */
export function updateBallMaterialView(_camera: THREE.Camera, dt = 0): void {
	updateBallHitFlash(dt);
}

export function bindGrassRenderer(renderer: THREE.WebGLRenderer): void {
	grassRenderer = renderer;
	applyGrassAnisotropy();
	if (pitchDetailRoughnessTexture) {
		pitchDetailRoughnessTexture.anisotropy =
			renderer.capabilities.getMaxAnisotropy();
	}
	if (pitchDetailNoiseTexture) {
		pitchDetailNoiseTexture.anisotropy =
			renderer.capabilities.getMaxAnisotropy();
	}
	if (pitchFloorMaterialCache?.map) {
		pitchFloorMaterialCache.map.anisotropy =
			renderer.capabilities.getMaxAnisotropy();
	}
	if (pitchFloorMaterialCache?.normalMap) {
		pitchFloorMaterialCache.normalMap.anisotropy =
			renderer.capabilities.getMaxAnisotropy();
	}
	if (ballAlbedoTexture) {
		ballAlbedoTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
	}
}

export function refreshAllGrassTextures(root: THREE.Object3D): void {
	root.traverse((obj) => {
		if (obj instanceof THREE.Mesh && obj.name === "pitchFloor") {
			obj.material = pitchGrassMaterial();
		}
	});
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
	const mats = Array.isArray(material) ? material : [material];
	for (const m of mats) m.dispose();
}

export function enhanceBall(
	root: THREE.Object3D,
	keepMeshyGeometry = false,
): void {
	if (keepMeshyGeometry) {
		const manifest = getMeshyArenaManifest();
		const meshyAlbedo = manifest?.ballAlbedo
			? getCachedMeshyTexture("ballAlbedo")
			: null;

		root.traverse((obj) => {
			if (obj instanceof THREE.Light) {
				obj.visible = false;
				obj.intensity = 0;
				return;
			}
			if (!(obj instanceof THREE.Mesh)) return;
			obj.castShadow = true;
			obj.receiveShadow = true;
			obj.renderOrder = 0;
			obj.frustumCulled = false;

			const src = Array.isArray(obj.material) ? obj.material[0] : obj.material;
			if (!(src instanceof THREE.MeshStandardMaterial)) return;

			const mat = src.clone();
			/** Meshy bywa czarne/metaliczne — wymuszamy czytelność vs murawa. */
			mat.metalness = Math.min(0.28, mat.metalness);
			mat.roughness = THREE.MathUtils.clamp(mat.roughness, 0.22, 0.55);
			mat.envMapIntensity = 2.7;
			mat.color.lerp(new THREE.Color(0xffffff), 0.45);
			mat.emissive = new THREE.Color(0x2a88a8);
			mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 1.75);
			mat.toneMapped = false;
			mat.fog = false;
			if (meshyAlbedo && !mat.map) {
				mat.map = meshyAlbedo;
			}
			if (mat instanceof THREE.MeshPhysicalMaterial) {
				mat.clearcoat = Math.max(mat.clearcoat, 0.55);
				mat.clearcoatRoughness = 0.1;
				mat.iridescence = Math.max(mat.iridescence, 0.2);
			}
			obj.material = mat;
		});
		root.visible = true;
		return;
	}

	const mat = createBallMaterial();
	const toRemove: THREE.Object3D[] = [];

	root.traverse((obj) => {
		if (obj instanceof THREE.Mesh) toRemove.push(obj);
	});

	for (const obj of toRemove) {
		obj.removeFromParent();
		if (obj instanceof THREE.Mesh) {
			obj.geometry?.dispose();
			disposeMaterial(obj.material);
		}
	}

	const geometry = new THREE.SphereGeometry(1, 64, 64);
	geometry.computeVertexNormals();

	const sphere = new THREE.Mesh(geometry, mat);
	sphere.name = "ballCore";
	sphere.castShadow = true;
	sphere.receiveShadow = true;
	sphere.renderOrder = 0;
	root.add(sphere);
	root.visible = true;
}

/** Płaski cień kontaktowy pod dolną krawędzią rampy. */
let rampShadowMatCache: THREE.MeshBasicMaterial | null = null;

export function flatRampShadowMaterial(): THREE.MeshBasicMaterial {
	if (!rampShadowMatCache) {
		rampShadowMatCache = new THREE.MeshBasicMaterial({
			color: 0x000000,
			transparent: true,
			opacity: 0.42,
			depthWrite: false,
			depthTest: true,
			blending: THREE.MultiplyBlending,
			polygonOffset: true,
			polygonOffsetFactor: -2,
			polygonOffsetUnits: -2,
		});
	}
	return rampShadowMatCache;
}

/** @deprecated Użyj flatRampShadowMaterial — zachowane dla kompatybilności headless. */
export function rampShadowMaterial(): THREE.MeshBasicMaterial {
	return flatRampShadowMaterial();
}

const rainbowNeonLedMat = new THREE.MeshStandardMaterial({
	color: 0xffffff,
	emissive: new THREE.Color().setHSL(0, 1.0, 0.5),
	emissiveIntensity: 2.4,
	roughness: 0.05,
	metalness: 0.2,
	transparent: false,
	opacity: 1.0,
	side: THREE.DoubleSide,
	depthWrite: true,
});

export function brightEdgeLedMaterial(
	_team: "blue" | "orange",
): THREE.MeshStandardMaterial {
	return rainbowNeonLedMat;
}

export function getBrightEdgeLedMaterials(): THREE.MeshStandardMaterial[] {
	return [rainbowNeonLedMat, rainbowNeonLedMat];
}

export function getRainbowNeonMaterial(): THREE.MeshStandardMaterial {
	return rainbowNeonLedMat;
}

/** Bieżący odcień tęczy neonów obwodu (0–1). */
export function getPerimeterLedHue(): number {
	return (Date.now() * 0.0002) % 1.0;
}

export function applyRainbowEmissive(
	mat: THREE.MeshStandardMaterial,
	hue?: number,
): void {
	const h = hue ?? getPerimeterLedHue();
	mat.emissive.setHSL(h, 1.0, 0.5);
	mat.emissiveIntensity = 1.85;
}

/** Neonowe bandy LED wokół stadionu. */
export function ledBannerMaterial(
	emissive: number,
): THREE.MeshStandardMaterial {
	const manifest = getMeshyArenaManifest();
	const hasBanner = !!manifest?.bannerPanel;
	const mat = new THREE.MeshStandardMaterial({
		color: hasBanner ? 0xffffff : 0x060a12,
		emissive: new THREE.Color(emissive),
		/** Wyższy emissive — bloom łapie bleed jak PT specular. */
		emissiveIntensity: hasBanner ? 1.35 : 1.55,
		roughness: hasBanner ? 0.28 : 0.4,
		metalness: hasBanner ? 0.7 : 0.5,
		envMapIntensity: hasBanner ? 1.45 : 0.85,
	});
	if (hasBanner) {
		const cached = getCachedMeshyTexture("bannerPanel");
		const tex =
			cached ??
			new THREE.TextureLoader().load(resolveMeshyTexture("bannerPanel", ""));
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.wrapS = THREE.RepeatWrapping;
		tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.set(4, 1.2);
		mat.map = tex;
	}
	return mat;
}

/** Emisyjne krawędzie bramek — cienki neon (StadiumLeds pulsuje intensity). */
export function goalFrameMaterial(
	emissive: number,
): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0x040608,
		emissive: new THREE.Color(emissive),
		emissiveIntensity: 2.2,
		roughness: 0.25,
		metalness: 0.1,
		toneMapped: false,
		envMapIntensity: 0.32,
	});
}

/** Półprzezroczyste ściany klatki — delikatna neonowa siatka (skybox prześwituje). */
let neonWallMaterialCache: THREE.ShaderMaterial | null = null;

export function neonWallMaterial(): THREE.ShaderMaterial {
	if (!neonWallMaterialCache) {
		neonWallMaterialCache = createNeonWallMaterial();
	}
	return neonWallMaterialCache;
}

/** Sufit areny — pulsujący heksagonalny grid (neon). */
export function arenaCeilingMaterial(): THREE.ShaderMaterial {
	return neonCeilingHexMaterial();
}

/** Cienka obwódka sufitu — czytelny „sufit jest tu”, bez zasłaniania. */
export function arenaCeilingEdgeMaterial(): THREE.LineBasicMaterial {
	return new THREE.LineBasicMaterial({
		color: 0x3dffe8,
		transparent: true,
		opacity: 0.22,
		depthWrite: false,
	});
}

const neonWireCache = new Map<number, THREE.LineBasicMaterial>();

/** Ostre neonowe krawędzie siatki 3D. */
export function neonWireMaterial(color = 0x00ffff): THREE.LineBasicMaterial {
	let mat = neonWireCache.get(color);
	if (!mat) {
		mat = new THREE.LineBasicMaterial({
			color,
			transparent: true,
			opacity: 0.88,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			fog: false,
		});
		neonWireCache.set(color, mat);
	}
	return mat;
}

/** Neonowa siatka krawędzi — wyłączona (powodowała lewitujące linie w powietrzu). */
export function attachNeonWireframe(
	_mesh: THREE.Mesh,
	_color = 0x00ffff,
): null {
	return null;
}
