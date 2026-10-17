/**
 * Dynamiczny env probe (CubeCamera) — realne odbicia na lakierze / clearcoat murawy.
 * Rzadka aktualizacja gdy Path tracing ON; VFX additive ukryte przy bake.
 * Cold-start: GradientEquirect z three-gpu-pathtracer aż CubeCamera się ugotuje.
 * Po bake: PMREM (CubeUV) — lepsze roughness-aware IBL niż raw cube.
 */

import * as THREE from "three";
import { GradientEquirectTexture } from "three-gpu-pathtracer";

import { isPathTraceLookEnabled } from "../../util/presentationPrefs";
import { resolveGraphicsSettings } from "../../util/graphicsProfile";

export class StadiumEnvProbe {
	private cube: THREE.CubeCamera | null = null;
	private target: THREE.WebGLCubeRenderTarget | null = null;
	private gradient: GradientEquirectTexture | null = null;
	private pmremFiltered: THREE.WebGLRenderTarget | null = null;
	private pmremGen: THREE.PMREMGenerator | null = null;
	private frame = 0;
	private readonly hideStack: THREE.Object3D[] = [];
	private readonly probePos = new THREE.Vector3(0, 4.5, 0);

	ensure(): void {
		if (this.cube) return;
		const size =
			resolveGraphicsSettings().quality === "high"
				? 192
				: resolveGraphicsSettings().quality === "medium"
					? 128
					: 64;
		this.target = new THREE.WebGLCubeRenderTarget(size, {
			type: THREE.HalfFloatType,
			colorSpace: THREE.LinearSRGBColorSpace,
			generateMipmaps: true,
			minFilter: THREE.LinearMipmapLinearFilter,
		});
		this.cube = new THREE.CubeCamera(0.5, 220, this.target);
		this.cube.name = "stadiumEnvProbe";

		if (!this.gradient) {
			this.gradient = new GradientEquirectTexture(256);
			this.gradient.topColor.set(0x2a4a78);
			this.gradient.bottomColor.set(0x120810);
			this.gradient.exponent = 1.05;
			this.gradient.update();
		}
	}

	/**
	 * @returns true jeśli zaktualizowano env mapę sceny
	 */
	update(
		renderer: THREE.WebGLRenderer,
		scene: THREE.Scene,
		force = false,
	): boolean {
		if (!isPathTraceLookEnabled()) return false;
		const q = resolveGraphicsSettings().quality;
		if (q === "low" || q === "deck") return false;

		this.ensure();
		if (!this.cube || !this.target) return false;

		this.frame++;
		/** High: rzadszy bake (droższy 192²) — eventy + ~4 s przy 60 fps. */
		const every = q === "high" ? 240 : 320;
		if (!force && this.frame % every !== 0) {
			if (!scene.environment) {
				scene.environment = this.gradient ?? this.target.texture;
				scene.environmentIntensity = 1.0;
			}
			return false;
		}

		this.hideForBake(scene);
		const prevBg = scene.background;
		const prevRt = renderer.getRenderTarget();
		const prevAutoClear = renderer.autoClear;
		try {
			this.cube.position.copy(this.probePos);
			this.cube.update(renderer, scene);
			if (!this.pmremGen) {
				this.pmremGen = new THREE.PMREMGenerator(renderer);
				this.pmremGen.compileCubemapShader();
			}
			const filtered = this.pmremGen.fromCubemap(this.target.texture);
			this.pmremFiltered?.dispose();
			this.pmremFiltered = filtered;
			scene.environment = filtered.texture;
			scene.environmentIntensity = 1.05;
			return true;
		} finally {
			scene.background = prevBg;
			renderer.setRenderTarget(prevRt);
			renderer.autoClear = prevAutoClear;
			this.restoreHidden();
		}
	}

	setProbePosition(x: number, y: number, z: number): void {
		this.probePos.set(x, y, z);
	}

	private hideForBake(scene: THREE.Scene): void {
		this.hideStack.length = 0;
		scene.traverse((obj) => {
			if (!obj.visible) return;
			if (obj === this.cube) return;
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
					if (m && m.blending === THREE.AdditiveBlending) {
						obj.visible = false;
						this.hideStack.push(obj);
						return;
					}
				}
				const n = obj.name || "";
				if (/reflector|planar|areaLight/i.test(n)) {
					obj.visible = false;
					this.hideStack.push(obj);
				}
			}
		});
	}

	private restoreHidden(): void {
		for (const o of this.hideStack) o.visible = true;
		this.hideStack.length = 0;
	}

	dispose(): void {
		this.restoreHidden();
		this.cube = null;
		this.target?.dispose();
		this.target = null;
		this.pmremFiltered?.dispose();
		this.pmremFiltered = null;
		this.pmremGen?.dispose();
		this.pmremGen = null;
		this.gradient?.dispose();
		this.gradient = null;
	}
}
