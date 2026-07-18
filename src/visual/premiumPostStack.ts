import * as THREE from "three";
import {
	BloomEffect,
	EffectComposer,
	EffectPass,
	RenderPass,
	ShaderPass,
} from "postprocessing";

import type { CinematicPostFx } from "./cinematicPostFx";
import {
	createLensFlarePost,
	type LensFlareLight,
	type LensFlarePost,
} from "./shaders/lensFlarePost";

/**
 * Match post stack:
 * Render → Bloom → cinematic look → lens flare.
 *
 * UnsignedByte + bez mipmapBlur — HalfFloat/MSAA/mipmap zostawiały
 * scissor/viewport na części ekranu (czarne pasy, „ucięty” kadr).
 */
export type PremiumPostStack = {
	composer: EffectComposer;
	bloom: BloomEffect;
	flare: LensFlarePost;
	renderPass: RenderPass;
	setSize: (w: number, h: number) => void;
	setScene: (scene: THREE.Scene, camera: THREE.Camera) => void;
	setBloomEnabled: (enabled: boolean) => void;
	setBloomStrength: (strength: number) => void;
	setLensFlares: (lights: LensFlareLight[], intensity?: number) => void;
	pulseSpectacle: (strength?: number) => void;
	update: (dt: number) => void;
	render: (dt: number) => void;
	dispose: () => void;
};

const _db = new THREE.Vector2();

export function createPremiumPostStack(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	cinematic: CinematicPostFx,
): PremiumPostStack {
	const composer = new EffectComposer(renderer, {
		multisampling: 0,
		frameBufferType: THREE.UnsignedByteType,
	});

	const renderPass = new RenderPass(scene, camera);
	const bloom = new BloomEffect({
		intensity: 0.38,
		luminanceThreshold: 0.84,
		luminanceSmoothing: 0.36,
		mipmapBlur: false,
		radius: 0.55,
	});
	const bloomPass = new EffectPass(camera, bloom);
	const lookPass = new ShaderPass(cinematic.material, "inputBuffer");
	const flare = createLensFlarePost();
	const flarePass = new ShaderPass(flare.material, "inputBuffer");

	composer.addPass(renderPass);
	composer.addPass(bloomPass);
	composer.addPass(lookPass);
	composer.addPass(flarePass);

	let spectacle = 0;
	let baseBloom = 0.38;
	let bloomEnabled = true;

	function resetGlState(): void {
		renderer.getDrawingBufferSize(_db);
		renderer.setRenderTarget(null);
		renderer.setViewport(0, 0, _db.x, _db.y);
		renderer.setScissor(0, 0, _db.x, _db.y);
		renderer.setScissorTest(false);
	}

	return {
		composer,
		bloom,
		flare,
		renderPass,
		setSize(w, h) {
			const width = Math.max(1, Math.floor(w));
			const height = Math.max(1, Math.floor(h));
			/** Composer.setSize sam woła renderer.setSize gdy logical size się zmienia. */
			composer.setSize(width, height, false);
			/**
			 * Po setPixelRatio logical size bywa ten sam — wymuś odświeżenie
			 * buforów z aktualnego drawingBufferSize.
			 */
			renderer.getDrawingBufferSize(_db);
			composer.inputBuffer.setSize(_db.x, _db.y);
			composer.outputBuffer.setSize(_db.x, _db.y);
			for (const pass of composer.passes) {
				pass.setSize(_db.x, _db.y);
			}
			resetGlState();
		},
		setScene(nextScene, nextCamera) {
			renderPass.mainScene = nextScene;
			renderPass.mainCamera = nextCamera;
			bloomPass.mainCamera = nextCamera;
		},
		setBloomEnabled(enabled) {
			bloomEnabled = enabled;
			bloomPass.enabled = enabled;
			if (!enabled) {
				bloom.intensity = 0;
			} else {
				bloom.intensity = baseBloom;
			}
		},
		setBloomStrength(strength) {
			baseBloom = Math.max(0, strength);
			if (bloomEnabled) {
				bloom.intensity = baseBloom + spectacle * 0.85;
			}
		},
		setLensFlares(lights, intensity = 0.85) {
			flare.setIntensity(intensity);
			flare.setLights(lights);
		},
		pulseSpectacle(strength = 0.85) {
			spectacle = Math.max(spectacle, THREE.MathUtils.clamp(strength, 0, 1.4));
		},
		update(dt) {
			spectacle = Math.max(0, spectacle - dt * 1.45);
			if (bloomEnabled) {
				bloom.intensity = baseBloom + spectacle * 0.95;
			}
		},
		render(dt) {
			renderer.resetState();
			resetGlState();
			composer.render(dt);
			renderer.resetState();
			resetGlState();
		},
		dispose() {
			flare.dispose();
			composer.dispose();
		},
	};
}
