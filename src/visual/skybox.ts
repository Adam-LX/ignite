import * as THREE from "three";

import { assetUrl } from "../util/assetUrl";

const SKYBOX_URL = assetUrl("/assets/textures/cyberpunk_skybox.png");
const ENV_INTENSITY = 0.36;

let skyboxReady = false;
let skyAssetVersion = "1";
const skyLoader = new THREE.TextureLoader();

function withCacheBust(url: string): string {
	return `${url}?v=${skyAssetVersion}`;
}

function waitForTextureImage(tex: THREE.Texture): Promise<THREE.Texture> {
	return new Promise((resolve, reject) => {
		const img = tex.image as HTMLImageElement | undefined;
		if (!img) {
			reject(new Error("FlyBall: skybox bez obrazu"));
			return;
		}
		if (img.complete && img.naturalWidth > 0) {
			resolve(tex);
			return;
		}
		img.onload = () => resolve(tex);
		img.onerror = () => reject(new Error("FlyBall: błąd dekodowania skyboxa"));
	});
}

function loadSkyTexture(): Promise<THREE.Texture> {
	return new Promise((resolve, reject) => {
		const url = withCacheBust(SKYBOX_URL);
		skyLoader.load(
			url,
			(tex) => {
				waitForTextureImage(tex)
					.then((ready) => {
						const img = ready.image as HTMLImageElement;
						console.info("FlyBall: skybox OK →", url, {
							w: img.naturalWidth,
							h: img.naturalHeight,
						});
						resolve(ready);
					})
					.catch(reject);
			},
			undefined,
			(err) =>
				reject(err instanceof Error ? err : new Error(`Nie wczytano ${url}`)),
		);
	});
}

function applySkyTexture(scene: THREE.Scene, skyTexture: THREE.Texture): void {
	skyTexture.mapping = THREE.EquirectangularReflectionMapping;
	skyTexture.colorSpace = THREE.SRGBColorSpace;
	skyTexture.minFilter = THREE.LinearFilter;
	skyTexture.magFilter = THREE.LinearFilter;
	skyTexture.generateMipmaps = false;

	// Equirectangular — poprawne mapowanie panoramy (nie na sferze z UV).
	scene.background = skyTexture;
	scene.environment = skyTexture;
	scene.environmentIntensity = ENV_INTENSITY;
}

/** Wczytaj panoramiczny skybox przed buildArena(). */
export async function preloadCyberpunkSkybox(
	scene: THREE.Scene,
): Promise<void> {
	if (skyboxReady) return;

	skyAssetVersion = String(Date.now());
	const skyTexture = await loadSkyTexture();
	applySkyTexture(scene, skyTexture);
	skyboxReady = true;
	console.info("FlyBall: cyberpunk skybox aktywny (background + environment)");
}

export function resetCyberpunkSkybox(): void {
	skyboxReady = false;
}
