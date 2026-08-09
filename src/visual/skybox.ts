import * as THREE from "three";
import { LightProbeGenerator } from "three/examples/jsm/lights/LightProbeGenerator.js";

import { assetUrl } from "../util/assetUrl";
import { createProceduralCyberSkyboxTexture } from "./proceduralSkybox";

const COMFY_SKYBOX_URL = assetUrl("/assets/textures/cyberpunk_skybox.png");
/**
 * Background + reflection fill — PMREM z Comfy skyboxa = główny wkład SM w lighting.
 * Skybox regeneruj: `npm run assets:arena-textures` (sekcja sky).
 *
 * Ambient / hemisphere film zostaje osobno — tu tylko tło vs IBL.
 *
 * Zasada: tło MUSI być ciemniejsze niż murawa w luminance — inaczej ACES+bloom = mleko.
 */
const ENV_INTENSITY = 0.68;
/**
 * Źródło equirect jest CIEMNE — podbijamy tło, żeby city/skyline były czytelne.
 * Mleko = snopy/flary soft (OFF), nie jasność skyboxa.
 */
const BACKGROUND_INTENSITY = 1.08;
const BACKGROUND_SATURATION = 1.5;
const BACKGROUND_CONTRAST = 1.22;
const BACKGROUND_VALUE = 1.05;
const BACKGROUND_PEAK_CAP = 0.78;
/** Blend L↔R equirect — źródłowy PNG ma hard seam (clip: dark blue | magenta). */
const EQUIRECT_WRAP_BLEND_FRAC = 0.045;
const SKY_ASSET_VERSION = "11";

export function getBaseEnvironmentIntensity(): number {
	return ENV_INTENSITY;
}

export function getSkyboxBackgroundIntensity(): number {
	return BACKGROUND_INTENSITY;
}

/** Trzymaj target intensity tła (GameSession / HMR). */
export function enforceSkyboxBackgroundIntensity(scene: THREE.Scene): void {
	scene.backgroundIntensity = BACKGROUND_INTENSITY;
}

let skyboxReady = false;
let skyAssetVersion = SKY_ASSET_VERSION;
const skyLoader = new THREE.TextureLoader();
let pmremRT: THREE.WebGLRenderTarget | null = null;
let giProbe: THREE.LightProbe | null = null;
let backgroundTex: THREE.Texture | null = null;

function withCacheBust(url: string): string {
	return `${url}?v=${skyAssetVersion}`;
}

function loadComfySkybox(): Promise<THREE.Texture> {
	return new Promise((resolve, reject) => {
		skyLoader.load(
			withCacheBust(COMFY_SKYBOX_URL),
			(tex) => {
				const img = tex.image as HTMLImageElement;
				if (img.naturalWidth < img.naturalHeight * 1.55) {
					reject(
						new Error("cyberpunk_skybox.png — zły aspect (oczekiwane 2:1)"),
					);
					return;
				}
				resolve(tex);
			},
			undefined,
			(err) =>
				reject(err instanceof Error ? err : new Error("Nie wczytano skyboxa")),
		);
	});
}

/**
 * Miękki crossfade L↔R — equirect musi się zamykać na ±180°.
 * Bez tego widać pionowy szew (ciemne niebo | magenta sunset) jak na klipie.
 */
function healEquirectWrapSeam(
	data: Uint8ClampedArray,
	w: number,
	h: number,
): void {
	const blend = Math.max(
		24,
		Math.min(Math.floor(w / 2) - 1, Math.round(w * EQUIRECT_WRAP_BLEND_FRAC)),
	);
	if (blend < 2) return;

	for (let y = 0; y < h; y++) {
		const row = y * w * 4;
		for (let i = 0; i < blend; i++) {
			const t = i / (blend - 1);
			/** 1 na samym brzegu → 0 w środku blendu. */
			const edge = 1 - t * t * (3 - 2 * t);
			const mix = 0.5 * edge;
			const li = row + i * 4;
			const ri = row + (w - 1 - i) * 4;
			for (let c = 0; c < 3; c++) {
				const L = data[li + c]!;
				const R = data[ri + c]!;
				data[li + c] = Math.round(L + (R - L) * mix);
				data[ri + c] = Math.round(R + (L - R) * mix);
			}
		}
	}
}

/**
 * Ciemne, kontrastowe tło — bez S-curve wash i bez jasnego horyzontu.
 * Źródło zostaje pod PMREM/IBL (też z heal wrap).
 */
function makeJuicyBackground(source: THREE.Texture): THREE.Texture {
	if (typeof document === "undefined") return source;
	const img = source.image as
		| HTMLImageElement
		| HTMLCanvasElement
		| ImageBitmap
		| null;
	if (!img) return source;

	const srcW =
		"naturalWidth" in img
			? img.naturalWidth || (img as HTMLImageElement).width
			: (img as ImageBitmap).width;
	const srcH =
		"naturalHeight" in img
			? img.naturalHeight || (img as HTMLImageElement).height
			: (img as ImageBitmap).height;
	if (!srcW || !srcH) return source;

	const scale = Math.min(1, 2048 / srcW);
	const w = Math.max(2, Math.round(srcW * scale));
	const h = Math.max(2, Math.round(srcH * scale));

	try {
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) return source;
		ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
		const frame = ctx.getImageData(0, 0, w, h);
		const d = frame.data;
		const sat = BACKGROUND_SATURATION;
		const contrast = BACKGROUND_CONTRAST;
		const valueMul = BACKGROUND_VALUE;
		const pivot = 0.28;
		const peakCap = BACKGROUND_PEAK_CAP;

		for (let i = 0; i < d.length; i += 4) {
			let r = d[i]! / 255;
			let g = d[i + 1]! / 255;
			let b = d[i + 2]! / 255;
			const nv = Math.floor(i / 4 / w) / Math.max(1, h - 1);
			const horizon = Math.max(0, 1 - Math.abs(nv - 0.5) * 3.4);

			r = (r - pivot) * contrast + pivot;
			g = (g - pivot) * contrast + pivot;
			b = (b - pivot) * contrast + pivot;

			const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			r = y + (r - y) * sat;
			g = y + (g - y) * sat;
			b = y + (b - y) * sat;

			r *= valueMul;
			g *= valueMul;
			b *= valueMul;

			/** Tylko najjaśniejsze plamy na horyzoncie — nie crush całego miasta. */
			if (horizon > 0.25) {
				const peakH = Math.max(r, g, b);
				if (peakH > 0.55) {
					const t = Math.min(1, (peakH - 0.55) / 0.55);
					const c = 1 - t * horizon * 0.35;
					r *= c;
					g *= c;
					b *= c;
				}
			}

			const peak = Math.max(r, g, b, 1e-6);
			if (peak > peakCap) {
				const s = peakCap / peak;
				r *= s;
				g *= s;
				b *= s;
			}

			d[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
			d[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
			d[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
		}
		healEquirectWrapSeam(d, w, h);
		ctx.putImageData(frame, 0, 0);
		const juicy = new THREE.CanvasTexture(canvas);
		juicy.colorSpace = THREE.SRGBColorSpace;
		juicy.mapping = THREE.EquirectangularReflectionMapping;
		juicy.minFilter = THREE.LinearMipmapLinearFilter;
		juicy.magFilter = THREE.LinearFilter;
		juicy.generateMipmaps = true;
		juicy.needsUpdate = true;
		return juicy;
	} catch {
		return source;
	}
}

/** Healed equirect pod PMREM — ten sam szew co na tle, bez grade. */
function makeSeamlessEquirect(source: THREE.Texture): THREE.Texture {
	if (typeof document === "undefined") return source;
	const img = source.image as
		| HTMLImageElement
		| HTMLCanvasElement
		| ImageBitmap
		| null;
	if (!img) return source;
	const srcW =
		"naturalWidth" in img
			? img.naturalWidth || (img as HTMLImageElement).width
			: (img as ImageBitmap).width;
	const srcH =
		"naturalHeight" in img
			? img.naturalHeight || (img as HTMLImageElement).height
			: (img as ImageBitmap).height;
	if (!srcW || !srcH) return source;

	const scale = Math.min(1, 2048 / srcW);
	const w = Math.max(2, Math.round(srcW * scale));
	const h = Math.max(2, Math.round(srcH * scale));
	try {
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) return source;
		ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
		const frame = ctx.getImageData(0, 0, w, h);
		healEquirectWrapSeam(frame.data, w, h);
		ctx.putImageData(frame, 0, 0);
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.mapping = THREE.EquirectangularReflectionMapping;
		tex.minFilter = THREE.LinearMipmapLinearFilter;
		tex.magFilter = THREE.LinearFilter;
		tex.generateMipmaps = true;
		tex.needsUpdate = true;
		return tex;
	} catch {
		return source;
	}
}

function disposeBackground(): void {
	if (!backgroundTex) return;
	backgroundTex.dispose();
	backgroundTex = null;
}

function disposePmremEnv(): void {
	if (giProbe) {
		giProbe.removeFromParent();
		giProbe = null;
	}
	pmremRT?.dispose();
	pmremRT = null;
}

/**
 * Background = ciemna kopia equirect; environment = PMREM ze źródła.
 */
function applySky(
	scene: THREE.Scene,
	sky: THREE.Texture,
	renderer?: THREE.WebGLRenderer | null,
): void {
	sky.mapping = THREE.EquirectangularReflectionMapping;
	sky.colorSpace = THREE.SRGBColorSpace;
	sky.minFilter = THREE.LinearMipmapLinearFilter;
	sky.magFilter = THREE.LinearFilter;
	sky.generateMipmaps = true;

	disposeBackground();
	backgroundTex = makeJuicyBackground(sky);
	scene.background = backgroundTex;

	disposePmremEnv();
	const envSource = makeSeamlessEquirect(sky);
	if (renderer) {
		const pmremGen = new THREE.PMREMGenerator(renderer);
		pmremGen.compileEquirectangularShader();
		pmremRT = pmremGen.fromEquirectangular(envSource);
		if (envSource !== sky) envSource.dispose();
		scene.environment = pmremRT.texture;
		try {
			giProbe = LightProbeGenerator.fromCubeRenderTarget(
				renderer,
				pmremRT as THREE.WebGLCubeRenderTarget,
			);
			/** Niższy GI — mniej liftu ambientu na murawie/niebie. */
			giProbe.intensity = 0.22;
			scene.add(giProbe);
		} catch (err) {
			console.warn("FlyBall: LightProbe GI — skip", err);
		}
		pmremGen.dispose();
	} else {
		scene.environment = envSource !== sky ? envSource : sky;
	}
	scene.environmentIntensity = ENV_INTENSITY;
	scene.backgroundIntensity = BACKGROUND_INTENSITY;
}

/** ComfyUI equirect 4096×2048 — tło areny (Meshy nie dotyczy skyboxa). */
export async function preloadCyberpunkSkybox(
	scene: THREE.Scene,
	renderer?: THREE.WebGLRenderer | null,
): Promise<void> {
	if (skyboxReady) return;

	skyAssetVersion = `${SKY_ASSET_VERSION}-${Date.now()}`;
	try {
		const sky = await loadComfySkybox();
		applySky(scene, sky, renderer);
		skyboxReady = true;
		console.info("FlyBall: ComfyUI cyberpunk skybox");
		return;
	} catch (err) {
		console.warn("FlyBall: ComfyUI skybox — fallback", err);
	}

	try {
		const proc = createProceduralCyberSkyboxTexture();
		applySky(scene, proc, renderer);
		skyboxReady = true;
	} catch (err) {
		console.warn("FlyBall: procedural skybox — fail", err);
		scene.background = new THREE.Color(0x120a20);
		scene.environment = null;
		scene.environmentIntensity = 0;
		skyboxReady = true;
	}
}

export function resetCyberpunkSkybox(): void {
	skyboxReady = false;
	disposeBackground();
	disposePmremEnv();
}
