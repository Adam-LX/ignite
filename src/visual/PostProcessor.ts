import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";

import type { GraphicsQuality } from "../util/graphicsProfile";
import { MatchColorGradeShader } from "./MatchColorGradeShader";
import { RainLensShader } from "./RainLensShader";
import {
	createLensFlarePost,
	type LensFlareLight,
	type LensFlarePost,
} from "./shaders/lensFlarePost";

/**
 * Match look: UnrealBloom → rain → color grade → FXAA/SMAA → lens flares → OutputPass.
 */
export class PostProcessor {
	public composer: EffectComposer;
	public readonly bloomPass: UnrealBloomPass;
	public readonly rainPass: ShaderPass;
	public readonly colorGradePass: ShaderPass;
	public readonly fxaaPass: ShaderPass;
	public readonly smaaPass: SMAAPass;
	public readonly flarePass: ShaderPass;
	private readonly flare: LensFlarePost;
	private readonly renderPass: RenderPass;
	private readonly renderer: THREE.WebGLRenderer;
	private matchChroma = 0;

	constructor(
		renderer: THREE.WebGLRenderer,
		scene: THREE.Scene,
		camera: THREE.PerspectiveCamera,
	) {
		this.renderer = renderer;
		this.composer = new EffectComposer(renderer);

		this.renderPass = new RenderPass(scene, camera);
		this.composer.addPass(this.renderPass);

		this.bloomPass = new UnrealBloomPass(
			new THREE.Vector2(window.innerWidth, window.innerHeight),
			0.3,
			0.22,
			0.93,
		);
		this.composer.addPass(this.bloomPass);

		this.rainPass = new ShaderPass(RainLensShader);
		this.rainPass.enabled = false;
		this.composer.addPass(this.rainPass);

		this.colorGradePass = new ShaderPass(MatchColorGradeShader);
		this.composer.addPass(this.colorGradePass);

		this.fxaaPass = new ShaderPass(FXAAShader);
		const pr0 = renderer.getPixelRatio();
		const w0 = Math.max(1, Math.floor(window.innerWidth * pr0));
		const h0 = Math.max(1, Math.floor(window.innerHeight * pr0));
		(this.fxaaPass.material.uniforms.resolution!.value as THREE.Vector2).set(
			1 / w0,
			1 / h0,
		);
		this.composer.addPass(this.fxaaPass);

		this.smaaPass = new SMAAPass(w0, h0);
		this.smaaPass.enabled = false;
		this.composer.addPass(this.smaaPass);

		this.flare = createLensFlarePost();
		this.flare.setIntensity(0.55);
		this.flarePass = new ShaderPass(this.flare.material);
		this.composer.addPass(this.flarePass);

		/** OutputPass — poprawny color-space / tonemap na końcu stacku. */
		this.composer.addPass(new OutputPass());
	}

	public setScene(scene: THREE.Scene, camera: THREE.Camera): void {
		this.renderPass.scene = scene;
		this.renderPass.camera = camera;
	}

	public setBloomStrength(strength: number): void {
		this.bloomPass.strength = Math.max(0, strength);
	}

	/** Niższy próg w menu — neony/bandy łapią bloom mimo odległej orbity. */
	public setBloomThreshold(threshold: number): void {
		this.bloomPass.threshold = THREE.MathUtils.clamp(threshold, 0, 1.5);
	}

	public setBloomEnabled(enabled: boolean): void {
		this.bloomPass.enabled = enabled;
	}

	/** High → SMAA; pozostałe → FXAA. */
	public setAaQuality(quality: GraphicsQuality): void {
		const useSmaa = quality === "high";
		this.smaaPass.enabled = useSmaa;
		this.fxaaPass.enabled = !useSmaa;
	}

	/** Atmosphere cool/warm → soczyste kolory w stylu RL (bez soap-opera). */
	public setColorGrade(cool: number, warm: number, saturation = 1.38): void {
		const u = this.colorGradePass.uniforms;
		u.uCool!.value = THREE.MathUtils.clamp(cool, 0, 1.2);
		u.uWarm!.value = THREE.MathUtils.clamp(warm, 0, 1.2);
		u.uSaturation!.value = THREE.MathUtils.clamp(saturation, 1, 1.5);
		/** Night film — lekki lift w dół żeby cienie na murawie nie wypalały. */
		u.uLift!.value = THREE.MathUtils.clamp(0.94 + warm * 0.04 - cool * 0.02, 0.88, 1.02);
	}

	/** Spektakl gola — krótki chromatic w match stacku. */
	public pulseMatchChroma(strength = 1): void {
		this.matchChroma = Math.max(
			this.matchChroma,
			THREE.MathUtils.clamp(strength, 0, 1.4),
		);
	}

	public updateMatchChroma(dt: number): void {
		if (this.matchChroma <= 0) {
			this.colorGradePass.uniforms.uChroma!.value = 0;
			return;
		}
		this.matchChroma = Math.max(0, this.matchChroma - dt * 1.65);
		this.colorGradePass.uniforms.uChroma!.value = this.matchChroma;
	}

	/** Jupiter / corner spot flares — mecz (nie tylko menu premium stack). */
	public setLensFlares(lights: LensFlareLight[], intensity = 0.55): void {
		this.flare.setIntensity(intensity);
		this.flare.setLights(lights);
		this.flarePass.enabled = lights.length > 0 && intensity > 0.02;
	}

	/** @deprecated Fisheye usunięty z stacku — no-op dla kompatybilności. */
	public setFisheyeEnabled(_enabled: boolean): void {
		/* no-op */
	}

	/** Aktualizuj krople na soczewce (time + intensywność z WeatherSystem). */
	public updateRainLens(delta: number, rainAmount: number): void {
		const amount = THREE.MathUtils.clamp(rainAmount, 0, 1);
		this.rainPass.uniforms.time!.value += delta;
		this.rainPass.uniforms.rainAmount!.value = amount;
		this.rainPass.enabled = amount > 0.001;
	}

	public render(): void {
		const gl = this.renderer;
		/** CSS px — Three setViewport mnoży przez DPR. drawingBuffer = podwójne DPR. */
		const css = gl.getSize(new THREE.Vector2());
		gl.setRenderTarget(null);
		gl.setViewport(0, 0, css.x, css.y);
		gl.setScissor(0, 0, css.x, css.y);
		gl.setScissorTest(false);
		this.composer.render();
	}

	public resize(width: number, height: number): void {
		const w = Math.max(1, Math.floor(width));
		const h = Math.max(1, Math.floor(height));
		/**
		 * setSize NIE czyta renderer.getPixelRatio() — trzyma stare _pixelRatio.
		 * Menu→mecz: PR 1→1.67 bez setPixelRatio = RT/viewport desync
		 * (YOU na środku z CSS2D, auto w orbicie w buforze GL).
		 */
		const pr = this.renderer.getPixelRatio();
		this.composer.setPixelRatio(pr);
		this.composer.setSize(w, h);
		const ew = Math.max(1, Math.floor(w * pr));
		const eh = Math.max(1, Math.floor(h * pr));
		this.bloomPass.resolution.set(ew, eh);
		this.bloomPass.setSize(ew, eh);
		this.smaaPass.setSize(ew, eh);
		const res = this.fxaaPass.material.uniforms.resolution?.value as
			| THREE.Vector2
			| undefined;
		if (res) {
			res.set(1 / ew, 1 / eh);
		}
	}
}
