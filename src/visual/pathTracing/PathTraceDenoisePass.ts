/**
 * Temporal + spatial denoise dla bufora path tracer.
 * Soft A-trous bilateral + history blend (bez motion vectors — camStable).
 */

import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tHistory;
uniform vec2 uTexel;
uniform float uSigma;
uniform float uStrength;
uniform float uTemporal;
uniform float uHasHistory;
varying vec2 vUv;

void main() {
	vec3 center = texture2D(tDiffuse, vUv).rgb;
	float lumC = dot(center, vec3(0.2126, 0.7152, 0.0722));
	vec3 acc = center * 0.28;
	float wsum = 0.28;
	for (int y = -2; y <= 2; y++) {
		for (int x = -2; x <= 2; x++) {
			if (x == 0 && y == 0) continue;
			float d = float(abs(x) + abs(y));
			vec2 uv = vUv + vec2(float(x), float(y)) * uTexel * uSigma;
			vec3 s = texture2D(tDiffuse, uv).rgb;
			float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
			float w = exp(-abs(lum - lumC) * 7.0 - d * 0.35) * 0.07;
			acc += s * w;
			wsum += w;
		}
	}
	vec3 spatial = acc / max(wsum, 1e-4);
	vec3 denoised = mix(center, spatial, uStrength);

	if (uHasHistory > 0.5 && uTemporal > 0.01) {
		vec3 hist = texture2D(tHistory, vUv).rgb;
		float lumH = dot(hist, vec3(0.2126, 0.7152, 0.0722));
		float clampW = exp(-abs(lumH - lumC) * 4.5);
		denoised = mix(denoised, hist, uTemporal * clampW);
	}
	gl_FragColor = vec4(denoised, 1.0);
}
`;

export class PathTraceDenoisePass {
	private readonly mat: THREE.ShaderMaterial;
	private readonly quad: FullScreenQuad;
	private readonly size = new THREE.Vector2(1, 1);
	private historyA: THREE.WebGLRenderTarget | null = null;
	private historyB: THREE.WebGLRenderTarget | null = null;
	private ping = false;
	private hasHistory = false;

	constructor() {
		this.mat = new THREE.ShaderMaterial({
			uniforms: {
				tDiffuse: { value: null as THREE.Texture | null },
				tHistory: { value: null as THREE.Texture | null },
				uTexel: { value: new THREE.Vector2(1, 1) },
				uSigma: { value: 1.35 },
				uStrength: { value: 0.55 },
				uTemporal: { value: 0.35 },
				uHasHistory: { value: 0 },
			},
			vertexShader: VERT,
			fragmentShader: FRAG,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
		});
		this.quad = new FullScreenQuad(this.mat);
	}

	setSize(w: number, h: number): void {
		const nw = Math.max(1, Math.floor(w));
		const nh = Math.max(1, Math.floor(h));
		if (this.size.x === nw && this.size.y === nh && this.historyA) {
			this.mat.uniforms.uTexel!.value.set(1 / nw, 1 / nh);
			return;
		}
		this.size.set(nw, nh);
		this.mat.uniforms.uTexel!.value.set(1 / nw, 1 / nh);
		this.disposeHistory();
		const opts: THREE.RenderTargetOptions = {
			type: THREE.HalfFloatType,
			format: THREE.RGBAFormat,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			depthBuffer: false,
			stencilBuffer: false,
		};
		this.historyA = new THREE.WebGLRenderTarget(nw, nh, opts);
		this.historyB = new THREE.WebGLRenderTarget(nw, nh, opts);
		this.hasHistory = false;
	}

	/**
	 * Denoise into history ping-pong. Returns the denoised texture (do not dispose).
	 * Caller blits to canvas (e.g. via bloom compose).
	 */
	process(
		renderer: THREE.WebGLRenderer,
		map: THREE.Texture,
		strength = 0.55,
		temporal = 0.35,
	): THREE.Texture {
		if (!this.historyA || !this.historyB) {
			const size = renderer.getDrawingBufferSize(new THREE.Vector2());
			this.setSize(size.x, size.y);
		}
		const readHist = this.ping ? this.historyA! : this.historyB!;
		const writeHist = this.ping ? this.historyB! : this.historyA!;

		this.mat.uniforms.tDiffuse!.value = map;
		this.mat.uniforms.tHistory!.value = readHist.texture;
		this.mat.uniforms.uStrength!.value = THREE.MathUtils.clamp(strength, 0, 1);
		this.mat.uniforms.uTemporal!.value = THREE.MathUtils.clamp(temporal, 0, 0.85);
		this.mat.uniforms.uHasHistory!.value = this.hasHistory ? 1 : 0;

		const prevTarget = renderer.getRenderTarget();
		renderer.setRenderTarget(writeHist);
		renderer.autoClear = true;
		this.quad.render(renderer);
		renderer.setRenderTarget(prevTarget);

		this.ping = !this.ping;
		this.hasHistory = true;
		return writeHist.texture;
	}

	/**
	 * Draw denoised `map` to canvas (and stash history for next frame).
	 */
	render(
		renderer: THREE.WebGLRenderer,
		map: THREE.Texture,
		strength = 0.55,
		temporal = 0.35,
	): void {
		const tex = this.process(renderer, map, strength, temporal);
		this.mat.uniforms.tDiffuse!.value = tex;
		this.mat.uniforms.uHasHistory!.value = 0;
		this.mat.uniforms.uStrength!.value = 0;
		this.mat.uniforms.uTemporal!.value = 0;
		const prevAuto = renderer.autoClear;
		renderer.autoClear = false;
		this.quad.render(renderer);
		renderer.autoClear = prevAuto;
	}

	resetHistory(): void {
		this.hasHistory = false;
	}

	private disposeHistory(): void {
		this.historyA?.dispose();
		this.historyB?.dispose();
		this.historyA = null;
		this.historyB = null;
		this.hasHistory = false;
	}

	dispose(): void {
		this.disposeHistory();
		this.mat.dispose();
		this.quad.dispose();
	}
}
