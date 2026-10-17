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
import { createAaaNextGenBundle } from "./aaa/aaaNextGen";
import type { CinematicPostFx } from "./cinematicPostFx";
import { LensHaloShader } from "./LensHaloShader";
import { MatchColorGradeShader } from "./MatchColorGradeShader";
import { RainLensShader } from "./RainLensShader";
import {
	createLensFlarePost,
	type LensFlareLight,
	type LensFlarePost,
} from "./shaders/lensFlarePost";
import { SpectacleFilmShader } from "./shaders/spectacleFilmShader";

/**
 * Unified post stack (menu + mecz):
 * Normal → Render → GTAO → SSGI → HybridSSR → TAA → Bloom → …
 * → FSR/RCAS → ACES → SMAA (gdy TAA off).
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
	setColorGrade: (cool: number, warm: number, saturation?: number, lift?: number) => void;
	pulseMatchChroma: (strength?: number) => void;
	updateMatchChroma: (dt: number) => void;
	updateRainLens: (delta: number, rainAmount: number) => void;
	updateLensArtifacts: (
		delta: number,
		opts: {
			haloAmount: number;
			dirtAmount: number;
			streakAmount: number;
		},
	) => void;
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

	const aaa = createAaaNextGenBundle(scene, camera);

	const renderPass = new RenderPass(scene, camera);
	const bloom = new BloomEffect({
		intensity: 0.28,
		luminanceThreshold: 0.88,
		luminanceSmoothing: 0.28,
		mipmapBlur: false,
		/** VERY_SMALL — punktowe highlighty; flary/snopy niosą glow. */
		kernelSize: KernelSize.VERY_SMALL,
		radius: 0.28,
	});
	const bloomPass = new EffectPass(camera, bloom);

	const rainMat = cloneShaderMaterial(RainLensShader);
	const rainPass = new ShaderPass(rainMat, "tDiffuse");
	rainPass.enabled = false;

	const haloMat = cloneShaderMaterial(LensHaloShader);
	const haloPass = new ShaderPass(haloMat, "tDiffuse");
	haloPass.enabled = false;

	const gradeMat = cloneShaderMaterial(MatchColorGradeShader);
	const gradePass = new ShaderPass(gradeMat, "tDiffuse");

	const lookPass = new ShaderPass(cinematic.material, "inputBuffer");

	const filmMat = cloneShaderMaterial(SpectacleFilmShader);
	const filmPass = new ShaderPass(filmMat, "tDiffuse");

	const flare = createLensFlarePost();
	const flarePass = new ShaderPass(flare.material, "tDiffuse");

	const tone = new ToneMappingEffect({
		mode: ToneMappingMode.ACES_FILMIC,
		/** Niższy whitePoint = wcześniejsze ścięcie highlightów (CP/RenoDX-like). */
		whitePoint: 2.75,
		middleGrey: 0.45,
	});
	const tonePass = new EffectPass(camera, tone);

	const smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
	const smaaPass = new EffectPass(camera, smaa);
	smaaPass.enabled = false;

	composer.addPass(aaa.normalPass);
	composer.addPass(renderPass);
	composer.addPass(aaa.gtaoPass);
	composer.addPass(aaa.ssgiPass);
	composer.addPass(aaa.hybridSsrPass);
	composer.addPass(aaa.taaPass);
	composer.addPass(bloomPass);
	composer.addPass(rainPass);
	composer.addPass(haloPass);
	composer.addPass(gradePass);
	composer.addPass(lookPass);
	composer.addPass(filmPass);
	composer.addPass(flarePass);
	composer.addPass(aaa.fsrPass);
	composer.addPass(tonePass);
	composer.addPass(smaaPass);

	let spectacle = 0;
	let baseBloom = 0.28;
	let bloomEnabled = true;
	let matchLook = false;
	let matchChroma = 0;
	let filmGrain = 0.35;
	let filmTime = 0;
	let quality: GraphicsQuality = "high";
	const menuThreshold = 0.78;
	/** Wyższy próg — mniej bloom-wash przy jupiterach (klip: przesada). */
	const matchThreshold = 0.92;

	function syncFilmUniforms(): void {
		filmMat.uniforms.uTime!.value = filmTime;
		filmMat.uniforms.uSpectacle!.value = spectacle;
		filmMat.uniforms.uGrain!.value = filmGrain;
		/** Low: grain off; pass zostaje dla chroma przy pulse. */
		filmPass.enabled = filmGrain > 0.001 || spectacle > 0.02;
	}

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
		bloom.intensity = baseBloom + spectacle * (matchLook ? 0.08 : 0.28);
	}

	function syncAaa(): void {
		aaa.setEnabledForQuality(quality, matchLook);
		/** SMAA na high — TAA wyłączone (było niestabilne). */
		smaaPass.enabled = quality === "high";
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
			aaa.setSize(_db.x, _db.y);
			resetGlState();
		},
		setScene(nextScene, nextCamera) {
			renderPass.mainScene = nextScene;
			renderPass.mainCamera = nextCamera;
			bloomPass.mainCamera = nextCamera;
			tonePass.mainCamera = nextCamera;
			smaaPass.mainCamera = nextCamera;
			aaa.setScene(nextScene, nextCamera);
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
			bloom.luminanceMaterial.smoothing = match ? 0.18 : 0.4;
			/**
			 * Kernel z recepty ustawia MatchOpticsDirector (small na high).
			 * Tu tylko menu fallback — nie nadpisuj VERY_SMALL przy każdym apply.
			 */
			if (!match) bloom.kernelSize = KernelSize.SMALL;
			/** Mecz: cinematic + ACES tonemap w stacku. */
			lookPass.enabled = true;
			tonePass.enabled = true;
			syncBloomIntensity();
			syncAaa();
		},
		setMultisampling(q) {
			quality = q;
			const samples = q === "high" ? 4 : q === "medium" ? 2 : 0;
			composer.multisampling = samples;
			if (q === "high") {
				smaa.applyPreset(SMAAPreset.HIGH);
			} else if (q === "medium") {
				smaa.applyPreset(SMAAPreset.MEDIUM);
			}
			/** Low: grain off; medium/high: soft grain. */
			filmGrain = q === "low" ? 0 : q === "medium" ? 0.14 : 0.28;
			syncFilmUniforms();
			syncAaa();
		},
		setColorGrade(cool, warm, saturation = 1.33, lift = 1.0) {
			const u = gradeMat.uniforms;
			u.uCool!.value = THREE.MathUtils.clamp(cool, 0, 1.2);
			u.uWarm!.value = THREE.MathUtils.clamp(warm, 0, 1.2);
			u.uSaturation!.value = THREE.MathUtils.clamp(saturation, 1, 1.75);
			u.uLift!.value = THREE.MathUtils.clamp(lift, 0.88, 1.08);
		},
		pulseMatchChroma(strength = 1) {
			matchChroma = Math.max(
				matchChroma,
				THREE.MathUtils.clamp(strength * 0.82, 0, 1.15),
			);
		},
		updateMatchChroma(dt) {
			if (matchChroma <= 0) {
				gradeMat.uniforms.uChroma!.value = 0;
				return;
			}
			matchChroma = Math.max(0, matchChroma - dt * 2.1);
			gradeMat.uniforms.uChroma!.value = matchChroma;
		},
		updateRainLens(delta, rainAmount) {
			const amount = THREE.MathUtils.clamp(rainAmount, 0, 1);
			rainMat.uniforms.time!.value =
				(rainMat.uniforms.time!.value as number) + delta;
			rainMat.uniforms.rainAmount!.value = amount;
			rainPass.enabled = amount > 0.001;
		},
		updateLensArtifacts(delta, opts) {
			const halo = THREE.MathUtils.clamp(opts.haloAmount, 0, 1.4);
			const dirt = THREE.MathUtils.clamp(opts.dirtAmount, 0, 1.2);
			const streak = THREE.MathUtils.clamp(opts.streakAmount, 0, 1.4);
			haloMat.uniforms.time!.value =
				(haloMat.uniforms.time!.value as number) + delta;
			haloMat.uniforms.haloAmount!.value = halo;
			haloMat.uniforms.dirtAmount!.value = dirt;
			haloMat.uniforms.streakAmount!.value = streak;
			haloPass.enabled = halo > 0.01 || dirt > 0.01 || streak > 0.01;
		},
		setLensFlares(lights, intensity = 1.05) {
			flare.setIntensity(intensity);
			flare.setLights(lights);
			flarePass.enabled = lights.length > 0 && intensity > 0.02;
		},
		pulseSpectacle(strength = 0.85) {
			spectacle = Math.max(
				spectacle,
				THREE.MathUtils.clamp(strength * 0.85, 0, 1.15),
			);
			syncBloomIntensity();
			syncFilmUniforms();
		},
		update(dt) {
			spectacle = Math.max(0, spectacle - dt * 1.75);
			filmTime += dt;
			syncBloomIntensity();
			syncFilmUniforms();
		},
		render(dt) {
			renderer.resetState();
			resetGlState();
			const cam = renderPass.mainCamera ?? camera;
			aaa.beginFrame(cam, dt);
			composer.render(dt);
			aaa.captureHistory(renderer, composer.inputBuffer.texture);
			aaa.endFrame(cam);
			renderer.resetState();
			resetGlState();
		},
		dispose() {
			flare.dispose();
			rainMat.dispose();
			haloMat.dispose();
			gradeMat.dispose();
			filmMat.dispose();
			aaa.dispose();
			composer.dispose();
		},
	};
}
