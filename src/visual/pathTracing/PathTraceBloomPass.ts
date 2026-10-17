/**
 * Lekki threshold bloom po path-trace blit — spekularne „shine” bez pełnego premium stack.
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

const EXTRACT = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform float uThreshold;
varying vec2 vUv;
void main() {
	vec3 c = texture2D(tDiffuse, vUv).rgb;
	float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
	float knee = max(lum - uThreshold, 0.0);
	gl_FragColor = vec4(c * (knee / (knee + 1.0)), 1.0);
}
`;

const COMPOSE = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float uStrength;
varying vec2 vUv;
void main() {
	vec3 base = texture2D(tDiffuse, vUv).rgb;
	vec3 bloom = texture2D(tBloom, vUv).rgb;
	gl_FragColor = vec4(base + bloom * uStrength, 1.0);
}
`;

export class PathTraceBloomPass {
	private readonly extractMat: THREE.ShaderMaterial;
	private readonly composeMat: THREE.ShaderMaterial;
	private readonly quad: FullScreenQuad;
	private bright: THREE.WebGLRenderTarget | null = null;
	private blurA: THREE.WebGLRenderTarget | null = null;
	private blurB: THREE.WebGLRenderTarget | null = null;
	private readonly blurMat: THREE.ShaderMaterial;

	constructor() {
		this.extractMat = new THREE.ShaderMaterial({
			uniforms: {
				tDiffuse: { value: null },
				uThreshold: { value: 0.72 },
			},
			vertexShader: VERT,
			fragmentShader: EXTRACT,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
		});
		this.blurMat = new THREE.ShaderMaterial({
			uniforms: {
				tDiffuse: { value: null },
				uDirection: { value: new THREE.Vector2(1, 0) },
				uTexel: { value: new THREE.Vector2(1, 1) },
			},
			vertexShader: VERT,
			fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uDirection;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
	vec3 a = texture2D(tDiffuse, vUv).rgb * 0.227027;
	a += texture2D(tDiffuse, vUv + uDirection * uTexel * 1.384615).rgb * 0.316216;
	a += texture2D(tDiffuse, vUv - uDirection * uTexel * 1.384615).rgb * 0.316216;
	a += texture2D(tDiffuse, vUv + uDirection * uTexel * 3.230769).rgb * 0.07027;
	a += texture2D(tDiffuse, vUv - uDirection * uTexel * 3.230769).rgb * 0.07027;
	gl_FragColor = vec4(a, 1.0);
}
`,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
		});
		this.composeMat = new THREE.ShaderMaterial({
			uniforms: {
				tDiffuse: { value: null },
				tBloom: { value: null },
				uStrength: { value: 0.35 },
			},
			vertexShader: VERT,
			fragmentShader: COMPOSE,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
		});
		this.quad = new FullScreenQuad(this.extractMat);
	}

	setSize(w: number, h: number): void {
		const nw = Math.max(1, Math.floor(w * 0.5));
		const nh = Math.max(1, Math.floor(h * 0.5));
		if (this.bright && this.bright.width === nw && this.bright.height === nh) {
			return;
		}
		this.disposeTargets();
		const opts: THREE.RenderTargetOptions = {
			type: THREE.HalfFloatType,
			format: THREE.RGBAFormat,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			depthBuffer: false,
		};
		this.bright = new THREE.WebGLRenderTarget(nw, nh, opts);
		this.blurA = new THREE.WebGLRenderTarget(nw, nh, opts);
		this.blurB = new THREE.WebGLRenderTarget(nw, nh, opts);
		this.blurMat.uniforms.uTexel!.value.set(1 / nw, 1 / nh);
	}

	/**
	 * `source` = path-traced (lub denoised) texture → canvas z lekkim bloom.
	 */
	render(
		renderer: THREE.WebGLRenderer,
		source: THREE.Texture,
		strength = 0.32,
	): void {
		if (!this.bright || !this.blurA || !this.blurB) {
			const s = renderer.getDrawingBufferSize(new THREE.Vector2());
			this.setSize(s.x, s.y);
		}
		const prev = renderer.getRenderTarget();
		const prevAuto = renderer.autoClear;

		this.extractMat.uniforms.tDiffuse!.value = source;
		this.quad.material = this.extractMat;
		renderer.setRenderTarget(this.bright);
		renderer.autoClear = true;
		this.quad.render(renderer);

		this.blurMat.uniforms.tDiffuse!.value = this.bright!.texture;
		this.blurMat.uniforms.uDirection!.value.set(1, 0);
		this.quad.material = this.blurMat;
		renderer.setRenderTarget(this.blurA);
		this.quad.render(renderer);

		this.blurMat.uniforms.tDiffuse!.value = this.blurA!.texture;
		this.blurMat.uniforms.uDirection!.value.set(0, 1);
		renderer.setRenderTarget(this.blurB);
		this.quad.render(renderer);

		this.composeMat.uniforms.tDiffuse!.value = source;
		this.composeMat.uniforms.tBloom!.value = this.blurB!.texture;
		this.composeMat.uniforms.uStrength!.value = strength;
		this.quad.material = this.composeMat;
		renderer.setRenderTarget(prev);
		renderer.autoClear = false;
		this.quad.render(renderer);
		renderer.autoClear = prevAuto;
	}

	private disposeTargets(): void {
		this.bright?.dispose();
		this.blurA?.dispose();
		this.blurB?.dispose();
		this.bright = null;
		this.blurA = null;
		this.blurB = null;
	}

	dispose(): void {
		this.disposeTargets();
		this.extractMat.dispose();
		this.blurMat.dispose();
		this.composeMat.dispose();
		this.quad.dispose();
	}
}
