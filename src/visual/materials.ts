import * as THREE from "three";

import { assetUrl } from "../util/assetUrl";
import { createNeonWallMaterial } from "./neonWallMaterial";

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
let grassColorTexture: THREE.Texture | null = null;
let grassNormalTexture: THREE.Texture | null = null;
let pitchDetailRoughnessTexture: THREE.Texture | null = null;
let pitchDetailNoiseTexture: THREE.Texture | null = null;
let proceduralBumpTexture: THREE.Texture | null = null;
let ballMaterialCache: THREE.ShaderMaterial | null = null;
let ballAlbedoTexture: THREE.Texture | null = null;

const BALL_EMISSIVE_BASE = 1.0;
const BALL_HIT_FLASH_PEAK = 4.5;
const BALL_HIT_FLASH_DECAY = 5.0;
const BALL_PROJ_SCALE = 0.4;

const BALL_ALBEDO_URL = assetUrl("/assets/textures/ball_cyber_albedo.jpg");
const BALL_ALBEDO_FALLBACK_URL = assetUrl(
	"/assets/textures/ball_cyber_albedo.png",
);

const BALL_TEXTURE_VERT = /* glsl */ `
varying vec3 vObjectNormal;
varying vec3 vViewNormal;

void main() {
	vObjectNormal = normal;
	vViewNormal = normalize(normalMatrix * normal);
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BALL_TEXTURE_FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform float uProjScale;
uniform float uHitFlash;

varying vec3 vObjectNormal;
varying vec3 vViewNormal;

vec2 ballUv(vec3 n) {
	vec3 f = n.z >= 0.0 ? n : vec3(-n.x, -n.y, -n.z);
	return clamp(f.xy / (1.0 + f.z) * uProjScale + 0.5, 0.02, 0.98);
}

void main() {
	vec3 n = normalize(vObjectNormal);
	vec3 tex = texture2D(tMap, ballUv(n)).rgb;

	float luma = dot(tex, vec3(0.299, 0.587, 0.114));
	vec3 chrome = vec3(0.58, 0.60, 0.64);
	tex = mix(chrome, tex, smoothstep(0.05, 0.14, luma));
	tex = clamp((tex - 0.5) * 1.2 + 0.5, 0.0, 1.0);
	tex = pow(max(tex, vec3(0.04)), vec3(0.86));

	float cyan = max(0.0, tex.b - max(tex.r, tex.g) * 0.74);
	vec3 neon = vec3(0.0, 0.88, 1.0) * cyan * uHitFlash;

	vec3 lightDir = normalize(vec3(0.32, 0.68, 0.66));
	float diff = 0.58 + 0.42 * max(0.0, dot(n, lightDir));
	vec3 col = tex * diff + neon;

	vec3 viewN = normalize(vViewNormal);
	float spec = pow(max(0.0, dot(viewN, normalize(vec3(0.18, 0.42, 0.89)))), 56.0);
	col += vec3(0.62, 0.66, 0.72) * spec * 0.38;

	gl_FragColor = vec4(col, 1.0);
}
`;

function configureBallTexture(tex: THREE.Texture): void {
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.anisotropy = grassRenderer?.capabilities.getMaxAnisotropy() ?? 16;
	tex.needsUpdate = true;
}

function onBallAlbedoLoaded(tex: THREE.Texture): void {
	configureBallTexture(tex);
	if (ballMaterialCache) {
		ballMaterialCache.uniforms.tMap.value = tex;
		ballMaterialCache.needsUpdate = true;
	}
}

function getBallAlbedoTexture(): THREE.Texture {
	if (ballAlbedoTexture) return ballAlbedoTexture;

	const loader = new THREE.TextureLoader();
	ballAlbedoTexture = loader.load(
		BALL_ALBEDO_URL,
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
	tex.repeat.set(4.71, 3.28);
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
		envMapIntensity: 0.08,
	});

	applyGrassAnisotropy();
	return grassMaterialCache;
}

/** Murawa boiska — grass_color + detail PBR. */
export function pitchFloorMaterial(): THREE.MeshStandardMaterial {
	if (pitchFloorMaterialCache) return pitchFloorMaterialCache;

	const loader = new THREE.TextureLoader();
	const color = loader.load(assetUrl("/assets/textures/grass_color.jpg"));
	const normal = loader.load(assetUrl("/assets/textures/grass_normal.jpg"));
	const detailRoughness = loader.load(
		assetUrl("/assets/textures/grass_roughness.jpg"),
	);
	const detailNoise = getPitchDetailNoiseTexture();

	grassColorTexture = color;
	grassNormalTexture = normal;
	pitchDetailRoughnessTexture = detailRoughness;
	setupGrassMap(color, THREE.SRGBColorSpace);
	color.repeat.set(1.031, 0.967);
	setupGrassMap(normal, THREE.LinearSRGBColorSpace, 0.31);
	normal.repeat.set(1.031, 0.967);

	setupPitchDetailMap(detailRoughness);

	pitchFloorMaterialCache = new THREE.MeshStandardMaterial({
		name: "pitchFloorGrassDetail",
		map: color,
		normalMap: normal,
		normalScale: new THREE.Vector2(0.38, 0.38),
		roughnessMap: detailNoise,
		aoMap: detailRoughness,
		aoMapIntensity: 0.42,
		roughness: 0.94,
		metalness: 0.0,
		color: 0xf0f2ee,
		envMapIntensity: 0.05,
	});

	if (grassRenderer && pitchFloorMaterialCache.map) {
		pitchFloorMaterialCache.map.anisotropy =
			grassRenderer.capabilities.getMaxAnisotropy();
	}
	return pitchFloorMaterialCache;
}

/** Murawa boiska — alias dla refreshAllGrassTextures. */
export function pitchGrassMaterial(): THREE.MeshStandardMaterial {
	return pitchFloorMaterial();
}

export function createBallMaterial(): THREE.ShaderMaterial {
	if (ballMaterialCache) return ballMaterialCache;

	ballMaterialCache = new THREE.ShaderMaterial({
		uniforms: {
			tMap: { value: getBallAlbedoTexture() },
			uProjScale: { value: BALL_PROJ_SCALE },
			uHitFlash: { value: BALL_EMISSIVE_BASE },
		},
		vertexShader: BALL_TEXTURE_VERT,
		fragmentShader: BALL_TEXTURE_FRAG,
	});
	return ballMaterialCache;
}

/** Rozbłysk neonu przy uderzeniu auta w piłkę. */
export function triggerBallHitFlash(intensity = 1.0): void {
	if (!ballMaterialCache) return;
	const peak = THREE.MathUtils.lerp(
		BALL_HIT_FLASH_PEAK,
		6.2,
		THREE.MathUtils.clamp(intensity, 0, 1),
	);
	const flash = ballMaterialCache.uniforms.uHitFlash;
	flash.value = Math.max(flash.value as number, peak);
}

/** Płynne wygaszanie rozbłysku w trakcie lotu piłki. */
export function updateBallHitFlash(dt: number): void {
	if (!ballMaterialCache || dt <= 0) return;
	const flash = ballMaterialCache.uniforms.uHitFlash;
	let value = flash.value as number;
	if (value <= BALL_EMISSIVE_BASE) return;
	value -= BALL_HIT_FLASH_DECAY * dt;
	flash.value = value < BALL_EMISSIVE_BASE ? BALL_EMISSIVE_BASE : value;
}

export function resetBallHitFlash(): void {
	if (!ballMaterialCache) return;
	ballMaterialCache.uniforms.uHitFlash.value = BALL_EMISSIVE_BASE;
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

export function enhanceBall(root: THREE.Object3D): void {
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
			opacity: 0.5,
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
	emissiveIntensity: 4.0,
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
	mat.emissiveIntensity = 4.0;
}

/** Neonowe bandy LED wokół stadionu. */
export function ledBannerMaterial(
	emissive: number,
): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0x060a12,
		emissive: new THREE.Color(emissive),
		emissiveIntensity: 5.0,
		roughness: 0.35,
		metalness: 0.55,
	});
}

/** Emisyjne obramowanie bramek — laserowe ramy. */
export function goalFrameMaterial(
	emissive: number,
): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0x04060c,
		emissive: new THREE.Color(emissive),
		emissiveIntensity: 4.0,
		roughness: 0.22,
		metalness: 0.78,
		transparent: true,
		opacity: 0.94,
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

/** Wewnętrzny sufit areny — zamyka dziurę w górę (wcześniej tylko collider fizyki). */
let arenaCeilingMaterialCache: THREE.MeshStandardMaterial | null = null;

export function arenaCeilingMaterial(): THREE.MeshStandardMaterial {
	if (!arenaCeilingMaterialCache) {
		arenaCeilingMaterialCache = new THREE.MeshStandardMaterial({
			color: 0x060a14,
			emissive: 0x0c1838,
			emissiveIntensity: 0.25,
			roughness: 0.92,
			metalness: 0.08,
			transparent: true,
			opacity: 0.32,
			side: THREE.DoubleSide,
			depthWrite: false,
		});
	}
	return arenaCeilingMaterialCache;
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
