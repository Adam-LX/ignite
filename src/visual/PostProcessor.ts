import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/**
 * Visual Valhalla — UnrealBloom na emisjach (neony, bramki, logo).
 * Osobny composer (three/examples); mecz renderuje przez ten stack.
 */
export class PostProcessor {
	public composer: EffectComposer;
	public readonly bloomPass: UnrealBloomPass;
	private readonly renderPass: RenderPass;

	constructor(
		renderer: THREE.WebGLRenderer,
		scene: THREE.Scene,
		camera: THREE.PerspectiveCamera,
	) {
		this.composer = new EffectComposer(renderer);

		this.renderPass = new RenderPass(scene, camera);
		this.composer.addPass(this.renderPass);

		this.bloomPass = new UnrealBloomPass(
			new THREE.Vector2(window.innerWidth, window.innerHeight),
			0.55, // Strength — wieczór
			0.32, // Radius
			0.97, // Threshold — tylko mocne neony
		);
		this.composer.addPass(this.bloomPass);
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

	public render(): void {
		this.composer.render();
	}

	public resize(width: number, height: number): void {
		const w = Math.max(1, Math.floor(width));
		const h = Math.max(1, Math.floor(height));
		this.composer.setSize(w, h);
		this.bloomPass.resolution.set(w, h);
		this.bloomPass.setSize(w, h);
	}
}
