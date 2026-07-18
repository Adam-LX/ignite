import * as THREE from "three";

import { assetUrl } from "../util/assetUrl";
import { createProceduralCyberSkyboxTexture } from "./proceduralSkybox";

const COMFY_SKYBOX_URL = assetUrl("/assets/textures/cyberpunk_skybox.png");
const ENV_INTENSITY = 0.42;

export function getBaseEnvironmentIntensity(): number {
	return ENV_INTENSITY;
}

let skyboxReady = false;
let skyAssetVersion = "1";
const skyLoader = new THREE.TextureLoader();

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

function applySky(scene: THREE.Scene, sky: THREE.Texture): void {
	sky.mapping = THREE.EquirectangularReflectionMapping;
	sky.colorSpace = THREE.SRGBColorSpace;
	sky.minFilter = THREE.LinearMipmapLinearFilter;
	sky.magFilter = THREE.LinearFilter;
	sky.generateMipmaps = true;
	scene.background = sky;
	scene.environment = sky;
	scene.environmentIntensity = ENV_INTENSITY;
}

/** ComfyUI equirect 4096×2048 — tło areny (Meshy nie dotyczy skyboxa). */
export async function preloadCyberpunkSkybox(
	scene: THREE.Scene,
): Promise<void> {
	if (skyboxReady) return;

	skyAssetVersion = String(Date.now());
	try {
		const sky = await loadComfySkybox();
		applySky(scene, sky);
		skyboxReady = true;
		console.info("FlyBall: ComfyUI cyberpunk skybox");
		return;
	} catch (err) {
		console.warn("FlyBall: ComfyUI skybox — fallback", err);
	}

	try {
		const proc = createProceduralCyberSkyboxTexture();
		applySky(scene, proc);
		skyboxReady = true;
	} catch {
		scene.background = new THREE.Color(0x120a20);
		scene.environment = null;
		scene.environmentIntensity = 0;
		skyboxReady = true;
	}
}

export function resetCyberpunkSkybox(): void {
	skyboxReady = false;
}
