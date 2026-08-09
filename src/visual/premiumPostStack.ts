import * as THREE from "three";
import {
	BloomEffect,
	EffectComposer,
	EffectPass,
	KernelSize,
	RenderPass,
	ShaderPass,
	SMAAEffect,
	SMAAPreset,
	ToneMappingEffect,
	ToneMappingMode,
} from "postprocessing";

import type { GraphicsQuality } from "../util/graphicsProfile";
import type { CinematicPostFx } from "./cinematicPostFx";
import { MatchColorGradeShader } from "./MatchColorGradeShader";
import { RainLensShader } from "./RainLensShader";
import {
	createLensFlarePost,
	type LensFlareLight,
	type LensFlarePost,
} from "./shaders/lensFlarePost";

/**
 * Unified post stack (menu + mecz):
 * Render → Bloom → rain → match grade → cinematic → flares → ACES tonemap.
 *
 * UnsignedByte — HalfFloat + mipmapBlur zostawiały scissor/viewport
 * na części ekranu (czarne pasy). MSAA w composerze (nie w kontekście
 * WebGL) — AA bez smugi przy direct-render garażu.
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
	setBloomThreshold: (threshold: number) => void;
	setMatchLook: (match: boolean) => void;
	setMultisampling: (quality: GraphicsQuality) => void;
	setColorGrade: (cool: number, warm: number, saturation?: number) => void;
	pulseMatchChroma: (strength?: number) => void;
	updateMatchChroma: (dt: number) => void;
	updateRainLens: (delta: number, rainAmount: number) => void;
	setLensFlares: (lights: LensFlareLight[], intensity?: number) => void;
	pulseSpectacle: (strength?: number) => void;
	update: (dt: number) => void;
	render: (dt: number) => void;
	dispose: () => void;
};

const _db = new THREE.Vector2();

function cloneShaderMaterial(def: {
	uniforms: Record<string, { value: unknown }>;
	vertexShader: string;
	fragmentShader: string;
}): THREE.ShaderMaterial {
	const uniforms: Record<string, THREE.IUniform> = {};
	for (const [key, u] of Object.entries(def.uniforms)) {
		uniforms[key] = { value: u.value };
	}
	return new THREE.ShaderMaterial({
		uniforms,
		vertexShader: def.vertexShader,
		fragmentShader: def.fragmentShader,
		depthTest: false,
		depthWrite: false,
	});
}

export function createPremiumPostStack(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	cinematic: CinematicPostFx,
): PremiumPostStack {
	const composer = new EffectComposer(renderer, {
		multisampling: 4,
		frameBufferType: THREE.UnsignedByteType,
	});

	const renderPass = new RenderPass(scene, camera);
	const bloom = new BloomEffect({
		intensity: 0.28,
		luminanceThreshold: 0.88,
		luminanceSmoothing: 0.32,
		mipmapBlur: false,
		/** VERY_SMALL — punktowe highlighty; flary/snopy niosą glow. */
		kernelSize: KernelSize.VERY_SMALL,
		radius: 0.28,
	});
	const bloomPass = new EffectPass(camera, bloom);

	const rainMat = cloneShaderMaterial(RainLensShader);
	const rainPass = new ShaderPass(rainMat, "tDiffuse");
	rainPass.enabled = false;

	const gradeMat = cloneShaderMaterial(MatchColorGradeShader);
	const gradePass = new ShaderPass(gradeMat, "tDiffuse");

	const lookPass = new ShaderPass(cinematic.material, "inputBuffer");
	const flare = createLensFlarePost();
	const flarePass = new ShaderPass(flare.material, "tDiffuse");

	const tone = new ToneMappingEffect({
		mode: ToneMappingMode.ACES_FILMIC,
	});
	const tonePass = new EffectPass(camera, tone);

	const smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
	const smaaPass = new EffectPass(camera, smaa);
	smaaPass.enabled = false;

	composer.addPass(renderPass);
	composer.addPass(bloomPass);
	composer.addPass(rainPass);
	composer.addPass(gradePass);
	composer.addPass(lookPass);
	composer.addPass(flarePass);
	composer.addPass(tonePass);
	composer.addPass(smaaPass);

	let spectacle = 0;
	let baseBloom = 0.28;
	let bloomEnabled = true;
	let matchLook = false;
	let matchChroma = 0;
	const menuThreshold = 0.78;
	/** Wyższy próg — mniej bloom-wash przy jupiterach (klip: przesada). */
	const matchThreshold = 0.96;

	function resetGlState(): void {
		/** CSS px — setViewport mnoży przez DPR; drawingBufferSize = offset w prawo. */
		renderer.getSize(_db);
		renderer.setRenderTarget(null);
		renderer.setViewport(0, 0, _db.x, _db.y);
		renderer.setScissor(0, 0, _db.x, _db.y);
		renderer.setScissorTest(false);
	}

	function syncBloomIntensity(): void {
		if (!bloomEnabled) {
			bloom.intensity = 0;
			return;
		}
		bloom.intensity = baseBloom + spectacle * (matchLook ? 0.1 : 0.35);
	}

	return {
		composer,
		bloom,
		flare,
		renderPass,
		setSize(w, h) {
			const width = Math.max(1, Math.floor(w));
			const height = Math.max(1, Math.floor(h));
			composer.setSize(width, height, false);
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
			tonePass.mainCamera = nextCamera;
			smaaPass.mainCamera = nextCamera;
		},
		setBloomEnabled(enabled) {
			bloomEnabled = enabled;
			bloomPass.enabled = enabled;
			syncBloomIntensity();
		},
		setBloomStrength(strength) {
			baseBloom = Math.max(0, strength);
			syncBloomIntensity();
		},
		setBloomThreshold(threshold) {
			bloom.luminanceMaterial.threshold = THREE.MathUtils.clamp(
				threshold,
				0,
				1.5,
			);
		},
		setMatchLook(match) {
			matchLook = match;
			bloom.luminanceMaterial.threshold = match
				? matchThreshold
				: menuThreshold;
			bloom.luminanceMaterial.smoothing = match ? 0.22 : 0.4;
			bloom.kernelSize = match
				? KernelSize.VERY_SMALL
				: KernelSize.SMALL;
			/** Mecz: cinematic + ACES tonemap w stacku. */
			lookPass.enabled = true;
			tonePass.enabled = true;
			syncBloomIntensity();
		},
		setMultisampling(quality) {
			const samples =
				quality === "high" ? 4 : quality === "medium" ? 2 : 0;
			composer.multisampling = samples;
			/** High: SMAA po tonemap (temporal-stable edge AA bez ghost blit). */
			smaaPass.enabled = quality === "high";
			if (quality === "high") {
				smaa.applyPreset(SMAAPreset.HIGH);
			} else if (quality === "medium") {
				smaa.applyPreset(SMAAPreset.MEDIUM);
			}
		},
		setColorGrade(cool, warm, saturation = 1.33) {
			const u = gradeMat.uniforms;
			u.uCool!.value = THREE.MathUtils.clamp(cool, 0, 1.2);
			u.uWarm!.value = THREE.MathUtils.clamp(warm, 0, 1.2);
			u.uSaturation!.value = THREE.MathUtils.clamp(saturation, 1, 1.75);
		},
		pulseMatchChroma(strength = 1) {
			matchChroma = Math.max(
				matchChroma,
				THREE.MathUtils.clamp(strength, 0, 1.4),
			);
		},
		updateMatchChroma(dt) {
			if (matchChroma <= 0) {
				gradeMat.uniforms.uChroma!.value = 0;
				return;
			}
			matchChroma = Math.max(0, matchChroma - dt * 1.65);
			gradeMat.uniforms.uChroma!.value = matchChroma;
		},
		updateRainLens(delta, rainAmount) {
			const amount = THREE.MathUtils.clamp(rainAmount, 0, 1);
			rainMat.uniforms.time!.value =
				(rainMat.uniforms.time!.value as number) + delta;
			rainMat.uniforms.rainAmount!.value = amount;
			rainPass.enabled = amount > 0.001;
		},
		setLensFlares(lights, intensity = 1.05) {
			flare.setIntensity(intensity);
			flare.setLights(lights);
			flarePass.enabled = lights.length > 0 && intensity > 0.02;
		},
		pulseSpectacle(strength = 0.85) {
			spectacle = Math.max(spectacle, THREE.MathUtils.clamp(strength, 0, 1.4));
			syncBloomIntensity();
		},
		update(dt) {
			spectacle = Math.max(0, spectacle - dt * 1.45);
			syncBloomIntensity();
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
			rainMat.dispose();
			gradeMat.dispose();
			composer.dispose();
		},
	};
}
