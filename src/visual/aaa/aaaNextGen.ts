/**
 * AAA next-gen presentation helpers — GTAO / TAA / SSGI / FSR / hybrid SSR.
 * Wpinane w premiumPostStack (beauty path), nie w full-frame RT.
 */

import * as THREE from "three";
import {
	BlendFunction,
	EffectPass,
	NormalPass,
	SSAOEffect,
	ShaderPass,
} from "postprocessing";

import type { GraphicsQuality } from "../../util/graphicsProfile";
import { isPathTraceLookEnabled } from "../../util/presentationPrefs";
import { getPitchWetness } from "../pitchWetness";
import { resolveHybridReflectionWeights } from "../reflections/PitchHybridReflection";
import { resolveGraphicsSettings } from "../../util/graphicsProfile";

const HALTON = [
	[0.5, 0.333],
	[0.25, 0.666],
	[0.75, 0.111],
	[0.125, 0.444],
	[0.625, 0.777],
	[0.375, 0.222],
	[0.875, 0.555],
	[0.0625, 0.888],
] as const;

export type AaaNextGenBundle = {
	normalPass: NormalPass;
	gtaoPass: EffectPass;
	ssgiPass: ShaderPass;
	hybridSsrPass: ShaderPass;
	taaPass: ShaderPass;
	fsrPass: ShaderPass;
	/** Wywołaj przed composer.render — jitter kamery pod TAA. */
	beginFrame: (camera: THREE.Camera, dt: number) => void;
	/** Po renderze — restore projection. */
	endFrame: (camera: THREE.Camera) => void;
	captureHistory: (renderer: THREE.WebGLRenderer, source: THREE.Texture) => void;
	setEnabledForQuality: (quality: GraphicsQuality, matchLook: boolean) => void;
	setScene: (scene: THREE.Scene, camera: THREE.Camera) => void;
	setSize: (w: number, h: number) => void;
	dispose: () => void;
};

function makeFullscreenMaterial(
	fragmentShader: string,
	uniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms,
		vertexShader: /* glsl */ `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
}

const SSGI_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uIntensity;
uniform float uEnabled;
varying vec2 vUv;

void main() {
	vec4 src = texture2D(tDiffuse, vUv);
	if (uEnabled < 0.5) {
		gl_FragColor = src;
		return;
	}
	/** Half-res-ish SSGI: cheap hemisphere taps in screen space. */
	vec2 px = 1.0 / vec2(textureSize(tDiffuse, 0));
	vec3 gi = vec3(0.0);
	float wSum = 0.0;
	for (int i = 0; i < 8; i++) {
		float a = float(i) * 2.399963;
		float r = (float(i) + 1.0) * 2.5;
		vec2 off = vec2(cos(a), sin(a)) * px * r;
		vec3 s = texture2D(tDiffuse, clamp(vUv + off, 0.0, 1.0)).rgb;
		float w = 1.0 / (1.0 + float(i) * 0.35);
		gi += s * w;
		wSum += w;
	}
	gi /= max(wSum, 1e-4);
	/** Soft bounce — nie myj midtones. */
	vec3 outc = src.rgb + (gi - src.rgb) * uIntensity * 0.22;
	outc = mix(src.rgb, outc, uIntensity);
	gl_FragColor = vec4(outc, src.a);
}
`;

const HYBRID_SSR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uStrength;
uniform float uWet;
uniform float uEnabled;
varying vec2 vUv;

void main() {
	vec4 src = texture2D(tDiffuse, vUv);
	if (uEnabled < 0.5 || uStrength < 0.01) {
		gl_FragColor = src;
		return;
	}
	/**
	 * Planar-biased SSR: odbij w dół ekranu (murawa / mokre powierzchnie).
	 * Pełny ray-march wymaga G-buffer; tu hybrydowy fill do planar+probe.
	 */
	vec2 px = 1.0 / vec2(textureSize(tDiffuse, 0));
	float pitchBias = smoothstep(0.12, 0.55, vUv.y) * (1.0 - smoothstep(0.72, 0.98, vUv.y));
	vec3 acc = vec3(0.0);
	float wSum = 0.0;
	for (int i = 1; i <= 6; i++) {
		float t = float(i) / 6.0;
		vec2 uv = vUv + vec2((vUv.x - 0.5) * 0.01 * t, -px.y * (8.0 + 28.0 * t));
		if (uv.y < 0.0 || uv.y > 1.0) break;
		vec3 s = texture2D(tDiffuse, uv).rgb;
		float w = (1.0 - t) * (1.0 - t);
		acc += s * w;
		wSum += w;
	}
	vec3 ssr = acc / max(wSum, 1e-4);
	float wet = clamp(uWet, 0.0, 1.0);
	float mixA = uStrength * pitchBias * (0.35 + wet * 0.55);
	/** Preferuj jaśniejsze lustro (jak wet pitch), bez czarnych dziur. */
	vec3 refl = max(ssr, src.rgb * 0.85);
	vec3 outc = mix(src.rgb, mix(src.rgb, refl, 0.55), mixA);
	gl_FragColor = vec4(outc, src.a);
}
`;

const TAA_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tHistory;
uniform float uBlend;
uniform float uEnabled;
uniform vec2 uJitter;
varying vec2 vUv;

void main() {
	vec4 curr = texture2D(tDiffuse, vUv);
	if (uEnabled < 0.5) {
		gl_FragColor = curr;
		return;
	}
	vec4 hist = texture2D(tHistory, vUv - uJitter);
	/** Neighborhood clamp — mniej ghostów. */
	vec3 nmin = curr.rgb;
	vec3 nmax = curr.rgb;
	vec2 px = 1.0 / vec2(textureSize(tDiffuse, 0));
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			vec3 s = texture2D(tDiffuse, vUv + vec2(float(x), float(y)) * px).rgb;
			nmin = min(nmin, s);
			nmax = max(nmax, s);
		}
	}
	hist.rgb = clamp(hist.rgb, nmin, nmax);
	float blend = clamp(uBlend, 0.05, 0.35);
	vec3 outc = mix(curr.rgb, hist.rgb, 1.0 - blend);
	gl_FragColor = vec4(outc, curr.a);
}
`;

const FSR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uSharpness;
uniform float uEnabled;
uniform vec2 uTexel;
varying vec2 vUv;

void main() {
	vec4 c = texture2D(tDiffuse, vUv);
	if (uEnabled < 0.5) {
		gl_FragColor = c;
		return;
	}
	/** EASU-lite bilateral upsample tip + RCAS sharpen. */
	vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;
	vec3 w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
	vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;
	vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
	vec3 blur = (e + w + n + s) * 0.25;
	vec3 soft = mix(c.rgb, blur, 0.18);
	/** RCAS-style: sharpen against local contrast. */
	float luma = dot(soft, vec3(0.2126, 0.7152, 0.0722));
	float nl = dot(n, vec3(0.2126, 0.7152, 0.0722));
	float sl = dot(s, vec3(0.2126, 0.7152, 0.0722));
	float el = dot(e, vec3(0.2126, 0.7152, 0.0722));
	float wl = dot(w, vec3(0.2126, 0.7152, 0.0722));
	float contrast = max(max(nl, sl), max(el, wl)) - min(min(nl, sl), min(el, wl));
	float sharp = uSharpness * (1.0 - smoothstep(0.05, 0.35, contrast));
	vec3 outc = soft + (soft - blur) * sharp;
	gl_FragColor = vec4(outc, c.a);
}
`;

export function createAaaNextGenBundle(
	scene: THREE.Scene,
	camera: THREE.Camera,
): AaaNextGenBundle {
	const normalPass = new NormalPass(scene, camera, { resolutionScale: 0.75 });
	normalPass.enabled = false;

	const ssao = new SSAOEffect(camera, normalPass.texture, {
		blendFunction: BlendFunction.MULTIPLY,
		samples: 12,
		rings: 5,
		intensity: 1.35,
		radius: 0.12,
		bias: 0.03,
		fade: 0.02,
		luminanceInfluence: 0.42,
		minRadiusScale: 0.15,
		worldDistanceThreshold: 55,
		worldDistanceFalloff: 18,
		worldProximityThreshold: 0.65,
		worldProximityFalloff: 0.2,
		resolutionScale: 0.55,
		depthAwareUpsampling: true,
		color: new THREE.Color(0x0a1210),
	});
	const gtaoPass = new EffectPass(camera, ssao);
	gtaoPass.enabled = false;

	const ssgiMat = makeFullscreenMaterial(SSGI_FRAG, {
		tDiffuse: { value: null },
		uIntensity: { value: 0.55 },
		uEnabled: { value: 0 },
	});
	const ssgiPass = new ShaderPass(ssgiMat, "tDiffuse");
	ssgiPass.enabled = false;

	const hybridMat = makeFullscreenMaterial(HYBRID_SSR_FRAG, {
		tDiffuse: { value: null },
		uStrength: { value: 0.28 },
		uWet: { value: 0.4 },
		uEnabled: { value: 0 },
	});
	const hybridSsrPass = new ShaderPass(hybridMat, "tDiffuse");
	hybridSsrPass.enabled = false;

	const historyRT = new THREE.WebGLRenderTarget(4, 4, {
		type: THREE.UnsignedByteType,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		depthBuffer: false,
	});
	historyRT.texture.name = "taaHistory";

	const taaMat = makeFullscreenMaterial(TAA_FRAG, {
		tDiffuse: { value: null },
		tHistory: { value: historyRT.texture },
		uBlend: { value: 0.18 },
		uEnabled: { value: 0 },
		uJitter: { value: new THREE.Vector2() },
	});
	const taaPass = new ShaderPass(taaMat, "tDiffuse");
	taaPass.enabled = false;

	const fsrMat = makeFullscreenMaterial(FSR_FRAG, {
		tDiffuse: { value: null },
		uSharpness: { value: 0.55 },
		uEnabled: { value: 0 },
		uTexel: { value: new THREE.Vector2(1, 1) },
	});
	const fsrPass = new ShaderPass(fsrMat, "tDiffuse");
	fsrPass.enabled = false;

	let frame = 0;
	let jitterX = 0;
	let jitterY = 0;
	let savedProjection: THREE.Matrix4 | null = null;
	let displayW = 1;
	let displayH = 1;
	let historyValid = false;
	const prevCamPos = new THREE.Vector3();
	const scratchPos = new THREE.Vector3();
	const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	const blitScene = new THREE.Scene();
	const blitMat = new THREE.MeshBasicMaterial({ map: null! });
	const blitMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
	blitScene.add(blitMesh);

	return {
		normalPass,
		gtaoPass,
		ssgiPass,
		hybridSsrPass,
		taaPass,
		fsrPass,
		beginFrame(cam, _dt) {
			frame++;
			if (!taaPass.enabled || !(cam instanceof THREE.PerspectiveCamera)) {
				jitterX = 0;
				jitterY = 0;
				(taaMat.uniforms.uJitter!.value as THREE.Vector2).set(0, 0);
				return;
			}
			cam.getWorldPosition(scratchPos);
			if (scratchPos.distanceToSquared(prevCamPos) > 2.25) {
				historyValid = false;
			}
			prevCamPos.copy(scratchPos);

			const h = HALTON[frame % HALTON.length]!;
			jitterX = (h[0] * 2 - 1) / Math.max(displayW, 1);
			jitterY = (h[1] * 2 - 1) / Math.max(displayH, 1);
			savedProjection = cam.projectionMatrix.clone();
			cam.projectionMatrix.elements[8] += jitterX;
			cam.projectionMatrix.elements[9] += jitterY;
			(taaMat.uniforms.uJitter!.value as THREE.Vector2).set(
				jitterX * 0.5,
				jitterY * 0.5,
			);
			taaMat.uniforms.uBlend!.value = historyValid ? 0.18 : 1.0;
			taaMat.uniforms.tHistory!.value = historyRT.texture;
			const hybrid = resolveHybridReflectionWeights(
				resolveGraphicsSettings().quality,
			);
			hybridMat.uniforms.uWet!.value = getPitchWetness();
			hybridMat.uniforms.uStrength!.value = hybrid.ssrStrength;
		},
		endFrame(cam) {
			if (savedProjection && cam instanceof THREE.PerspectiveCamera) {
				cam.projectionMatrix.copy(savedProjection);
				savedProjection = null;
			}
		},
		/** Skopiuj wynik beauty → historia TAA (wołaj po composer.render). */
		captureHistory(renderer: THREE.WebGLRenderer, source: THREE.Texture) {
			if (!taaPass.enabled) {
				historyValid = false;
				return;
			}
			blitMat.map = source;
			const prev = renderer.getRenderTarget();
			renderer.setRenderTarget(historyRT);
			renderer.render(blitScene, blitCam);
			renderer.setRenderTarget(prev);
			historyValid = true;
		},
		setEnabledForQuality(quality, matchLook) {
			const pt = isPathTraceLookEnabled();
			const high = matchLook && quality === "high" && pt;
			const med = matchLook && quality === "medium" && pt;
			/**
			 * Stabilny subset — SSGI / hybrid SSR / TAA dawały wash, plamki i smugi
			 * (Free Cam midfield). Zostawiamy GTAO + RCAS sharpen.
			 */
			normalPass.enabled = high || med;
			gtaoPass.enabled = high || med;
			ssao.intensity = high ? 0.95 : med ? 0.7 : 0;

			ssgiPass.enabled = false;
			ssgiMat.uniforms.uEnabled!.value = 0;

			hybridSsrPass.enabled = false;
			hybridMat.uniforms.uEnabled!.value = 0;

			taaPass.enabled = false;
			taaMat.uniforms.uEnabled!.value = 0;
			historyValid = false;

			fsrPass.enabled = high || med;
			fsrMat.uniforms.uEnabled!.value = high || med ? 1 : 0;
			fsrMat.uniforms.uSharpness!.value = high ? 0.42 : 0.32;
		},
		setScene(nextScene, nextCamera) {
			normalPass.mainScene = nextScene;
			normalPass.mainCamera = nextCamera;
			gtaoPass.mainCamera = nextCamera;
		},
		setSize(w, h) {
			displayW = Math.max(1, Math.floor(w));
			displayH = Math.max(1, Math.floor(h));
			historyRT.setSize(displayW, displayH);
			(fsrMat.uniforms.uTexel!.value as THREE.Vector2).set(
				1 / displayW,
				1 / displayH,
			);
			historyValid = false;
		},
		dispose() {
			historyRT.dispose();
			ssgiMat.dispose();
			hybridMat.dispose();
			taaMat.dispose();
			fsrMat.dispose();
			blitMat.dispose();
			blitMesh.geometry.dispose();
			ssao.dispose();
			normalPass.dispose();
			gtaoPass.dispose();
		},
	};
}
