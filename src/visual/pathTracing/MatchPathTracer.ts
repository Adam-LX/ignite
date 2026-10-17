/**
 * Match path tracer — hybrydowy pipeline (2026):
 * 1) Raster Three.js (ostre auta / HUD-czytelność)
 * 2) WebGLPathTracer (prawdziwe bounces BVH) z fade / low-res preview
 * 3) VFX additive / Points wyłączane z BVH (duchy + hitch)
 * 4) Adaptive SPP wg budżetu klatki
 */

import * as THREE from "three";
import { WebGLPathTracer } from "three-gpu-pathtracer";

import { isPathTraceLookEnabled } from "../../util/presentationPrefs";
import { resolveGraphicsSettings } from "../../util/graphicsProfile";
import { PathTraceDenoisePass } from "./PathTraceDenoisePass";
import { PathTraceBloomPass } from "./PathTraceBloomPass";

export type PathTraceFrameStats = {
	samples: number;
	spp: number;
	rebuilt: boolean;
	ms: number;
};

export class MatchPathTracer {
	private tracer: WebGLPathTracer | null = null;
	private readonly renderer: THREE.WebGLRenderer;
	private lastRebuildAt = -1e9;
	private lastCamPos = new THREE.Vector3();
	private lastCamQuat = new THREE.Quaternion();
	private enabled = false;
	private initFailed = false;
	private sceneBound: THREE.Scene | null = null;
	private frameMsEma = 16;
	private readonly hideStack: THREE.Object3D[] = [];
	private readonly denoise = new PathTraceDenoisePass();
	private readonly bloom = new PathTraceBloomPass();
	private lastStats: PathTraceFrameStats = {
		samples: 0,
		spp: 0,
		rebuilt: false,
		ms: 0,
	};

	constructor(renderer: THREE.WebGLRenderer) {
		this.renderer = renderer;
	}

	isActive(): boolean {
		return this.enabled && this.tracer !== null && !this.initFailed;
	}

	getLastStats(): PathTraceFrameStats {
		return this.lastStats;
	}

	syncEnabled(): void {
		const want = isPathTraceLookEnabled();
		if (!want) {
			this.enabled = false;
			return;
		}
		if (this.initFailed) {
			this.enabled = false;
			return;
		}
		this.enabled = true;
		this.ensureTracer();
	}

	private ensureTracer(): void {
		if (this.tracer || this.initFailed) return;
		try {
			const pt = new WebGLPathTracer(this.renderer);
			/** Hybryda: raster zawsze dostępny, PT fade-in. */
			pt.rasterizeScene = true;
			pt.renderToCanvas = true;
			pt.dynamicLowRes = true;
			pt.lowResScale = 0.28;
			pt.minSamples = 0;
			pt.fadeDuration = 90;
			pt.renderDelay = 0;
			pt.synchronizeRenderSize = true;
			pt.multipleImportanceSampling = true;
			pt.filterGlossyFactor = 0.78;
			pt.bounces = 5;
			pt.transmissiveBounces = 2;
			pt.tiles.set(2, 2);
			pt.renderScale = 0.75;
			pt.textureSize.set(1536, 1536);

			pt.rasterizeSceneCallback = (scene, camera) => {
				const prevTone = this.renderer.toneMapping;
				const prevExp = this.renderer.toneMappingExposure;
				this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
				this.renderer.toneMappingExposure = 0.92;
				this.renderer.render(scene, camera);
				this.renderer.toneMapping = prevTone;
				this.renderer.toneMappingExposure = prevExp;
			};

			pt.renderToCanvasCallback = (target, renderer, _quad) => {
				const q = resolveGraphicsSettings().quality;
				const samples = this.tracer?.samples ?? 0;
				const strength =
					q === "high" ? 0.42 : q === "medium" ? 0.52 : 0.62;
				const temporal = THREE.MathUtils.clamp(
					0.55 - samples * 0.02,
					0.12,
					0.55,
				);
				const size = renderer.getDrawingBufferSize(new THREE.Vector2());
				const dw = Math.floor(size.x * (pt.renderScale || 1));
				const dh = Math.floor(size.y * (pt.renderScale || 1));
				this.denoise.setSize(dw, dh);
				this.bloom.setSize(dw, dh);
				const denoised = this.denoise.process(
					renderer,
					target.texture,
					strength,
					temporal,
				);
				const bloomStr =
					q === "high" ? 0.38 : q === "medium" ? 0.28 : 0.18;
				this.bloom.render(renderer, denoised, bloomStr);
			};

			this.tracer = pt;
		} catch (err) {
			console.error("[ignite] WebGLPathTracer init failed", err);
			this.initFailed = true;
			this.tracer = null;
			this.enabled = false;
		}
	}

	renderFrame(
		scene: THREE.Scene,
		camera: THREE.Camera,
		timeSec: number,
	): boolean {
		this.syncEnabled();
		if (!this.isActive() || !this.tracer) return false;

		const t0 = performance.now();
		const q = resolveGraphicsSettings().quality;
		this.applyQuality(q);

		const needRebuild =
			this.sceneBound !== scene ||
			timeSec - this.lastRebuildAt >= this.rebuildIntervalSec(q);

		let rebuilt = false;
		try {
			if (needRebuild) {
				this.withCleanSceneForBvh(scene, () => {
					this.tracer!.setScene(scene, camera);
				});
				try {
					this.tracer.updateMaterials();
					this.tracer.updateLights();
				} catch {
					/* ignore */
				}
				this.sceneBound = scene;
				this.lastRebuildAt = timeSec;
				this.lastCamPos.copy(camera.position);
				this.lastCamQuat.copy(camera.quaternion);
				rebuilt = true;
			} else {
				this.tracer.setCamera(camera);
				const camMoved =
					this.lastCamPos.distanceToSquared(camera.position) > 0.0064 ||
					1 - Math.abs(this.lastCamQuat.dot(camera.quaternion)) > 0.00035;
				if (camMoved) {
					this.tracer.updateCamera();
					this.denoise.resetHistory();
					this.lastCamPos.copy(camera.position);
					this.lastCamQuat.copy(camera.quaternion);
				} else {
					/** updateCamera() resetuje samples — unikaj przy mikro-ruchu chase. */
					this.tracer.updateLights();
					/** Stabilna kamera = więcej spp → mniej ziarna, widać bounces. */
					if (q === "high") {
						this.frameMsEma = Math.min(this.frameMsEma, 14);
					}
				}
			}

			const spp = this.adaptiveSpp(q);
			/** Stabilna kamera: pełniejszy renderScale → ostrzejsze odbicia. */
			if (
				q === "high" &&
				!rebuilt &&
				this.lastCamPos.distanceToSquared(camera.position) < 0.0004
			) {
				this.tracer.renderScale = Math.min(0.92, this.tracer.renderScale + 0.04);
			}
			for (let i = 0; i < spp; i++) {
				this.tracer.renderSample();
			}

			const ms = performance.now() - t0;
			this.frameMsEma = this.frameMsEma * 0.85 + ms * 0.15;
			this.lastStats = {
				samples: this.tracer.samples,
				spp,
				rebuilt,
				ms,
			};
			return true;
		} catch (err) {
			console.error("[ignite] path trace frame failed — fallback raster", err);
			this.initFailed = true;
			this.enabled = false;
			this.restoreHidden();
			return false;
		}
	}

	private applyQuality(q: string): void {
		if (!this.tracer) return;
		if (q === "high") {
			this.tracer.renderScale = 0.78;
			this.tracer.bounces = 5;
			this.tracer.tiles.set(2, 2);
			this.tracer.lowResScale = 0.32;
		} else if (q === "medium") {
			this.tracer.renderScale = 0.58;
			this.tracer.bounces = 3;
			this.tracer.tiles.set(3, 3);
			this.tracer.lowResScale = 0.26;
		} else {
			this.tracer.renderScale = 0.42;
			this.tracer.bounces = 2;
			this.tracer.tiles.set(3, 3);
			this.tracer.lowResScale = 0.22;
		}
	}

	private adaptiveSpp(q: string): number {
		const budget = q === "high" ? 24 : q === "medium" ? 18 : 14;
		if (this.frameMsEma > budget * 1.4) return 1;
		if (q === "high" && this.frameMsEma < budget * 0.65) return 4;
		if (q === "high" && this.frameMsEma < budget * 0.85) return 3;
		if (q === "high") return 2;
		if (q === "medium" && this.frameMsEma < budget * 0.8) return 2;
		return 1;
	}

	private rebuildIntervalSec(q: string): number {
		/** Dynamic cars: częstszy rebuild na high. */
		if (q === "high") return 0.1;
		if (q === "medium") return 0.16;
		return 0.26;
	}

	/**
	 * Points / additive VFX / CSS warstwy nie powinny wchodzić do BVH —
	 * dawały duchy boostów i koszt rebuildu.
	 */
	private withCleanSceneForBvh(scene: THREE.Scene, fn: () => void): void {
		this.hideStack.length = 0;
		scene.traverse((obj) => {
			if (!obj.visible) return;
			if (obj instanceof THREE.Points || obj instanceof THREE.Sprite) {
				obj.visible = false;
				this.hideStack.push(obj);
				return;
			}
			if (obj instanceof THREE.Mesh) {
				const mats = Array.isArray(obj.material)
					? obj.material
					: [obj.material];
				for (const m of mats) {
					if (
						m &&
						(m.blending === THREE.AdditiveBlending ||
							m.blending === THREE.MultiplyBlending ||
							(m.transparent && m.opacity < 0.15))
					) {
						obj.visible = false;
						this.hideStack.push(obj);
						return;
					}
				}
				/** Nazwy VFX / haze / trail */
				const n = obj.name || "";
				if (
					/boost|trail|spark|flame|haze|streak|afterimage|beam|gobo|laser|pyro|reflector|planar/i.test(
						n,
					)
				) {
					obj.visible = false;
					this.hideStack.push(obj);
				}
			}
		});
		try {
			fn();
		} finally {
			this.restoreHidden();
		}
	}

	private restoreHidden(): void {
		for (const o of this.hideStack) o.visible = true;
		this.hideStack.length = 0;
	}

	/** Po bake env probe — przeładuj IBL w materialach PT. */
	notifyEnvironmentChanged(): void {
		if (!this.tracer || !this.isActive()) return;
		try {
			this.tracer.updateMaterials();
		} catch {
			/* ignore */
		}
	}

	invalidateScene(): void {
		this.sceneBound = null;
		this.lastRebuildAt = -1e9;
		this.denoise.resetHistory();
		this.tracer?.reset();
	}

	dispose(): void {
		this.restoreHidden();
		this.denoise.dispose();
		this.bloom.dispose();
		this.tracer?.dispose();
		this.tracer = null;
		this.sceneBound = null;
	}
}
