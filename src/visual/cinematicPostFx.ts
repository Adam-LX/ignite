import * as THREE from "three";

import type { GraphicsQuality } from "../util/graphicsProfile";
import { SUPERSONIC_MPS } from "./supersonicBreak";

/** Normalizacja prędkości auta → intensywność efektów kinowych (0–1). */
export function computeCinematicIntensity(
	speedMps: number,
	boosting: boolean,
	pulse = 0,
): number {
	const speedNorm = THREE.MathUtils.clamp(speedMps / SUPERSONIC_MPS, 0, 1.35);
	const boost = boosting ? 0.22 : 0;
	return THREE.MathUtils.clamp(speedNorm * 0.78 + boost + pulse * 0.58, 0, 1);
}

export type PremiumFxInput = {
	focusUv: THREE.Vector2;
	dofStrength: number;
	motionBlurDir: THREE.Vector2;
	motionBlurStrength: number;
};

/** Uniform name: inputBuffer — pod pmndrs ShaderPass. */
const CINEMATIC_FRAGMENT = /* glsl */ `
uniform sampler2D inputBuffer;
uniform float uTime;
uniform float uIntensity;
uniform float uBoost;
uniform float uPulse;
uniform float uChromaticBurst;
uniform vec2 uFocusUv;
uniform float uDoFStrength;
uniform vec2 uMotionBlurDir;
uniform float uMotionBlurStrength;
uniform float uCoolGrade;
uniform float uWarmGrade;
uniform float uPremiumScale;
uniform float uMenuMode;
uniform float uVignette;

varying vec2 vUv;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 sampleScene(vec2 uv) {
	return texture2D(inputBuffer, clamp(uv, 0.001, 0.999)).rgb;
}

vec3 samplePremium(vec2 uv) {
	vec3 col = sampleScene(uv);
	float dof = uDoFStrength * uPremiumScale;
	float mot = uMotionBlurStrength * uPremiumScale;
	if (dof < 0.008 && mot < 0.008) return col;
	if (uMenuMode > 0.5) return col;

	float distFocus = length(uv - uFocusUv);
	float dofAmt = dof * smoothstep(0.1, 0.62, distFocus);
	/** Bokeh prawie tylko na niebie — murawa / piłka czytelne. */
	float skyMask = smoothstep(0.55, 0.82, uv.y);
	dofAmt *= mix(0.08, 1.0, skyMask);
	if (dofAmt < 0.004 && mot < 0.008) return col;

	vec3 acc = col;
	float wsum = 1.0;

	for (int i = 0; i < 6; i++) {
		float a = float(i) * 1.0471976;
		vec2 off = vec2(cos(a), sin(a)) * dofAmt * 0.014;
		acc += sampleScene(uv + off);
		wsum += 1.0;
	}
	for (int i = 0; i < 6; i++) {
		float a = float(i) * 1.0471976 + 0.35;
		vec2 off = vec2(cos(a), sin(a)) * dofAmt * 0.026 * skyMask;
		acc += sampleScene(uv + off) * 0.5;
		wsum += 0.5;
	}

	if (mot > 0.02) {
		/** Motion blur słabszy i krótszy — mniej myje boisko. */
		for (int j = 1; j <= 2; j++) {
			float f = float(j) / 2.0;
			vec2 off = uMotionBlurDir * mot * f * 0.009;
			acc += sampleScene(uv - off);
			wsum += 1.0;
		}
	}

	return acc / wsum;
}

vec3 softBloom(vec2 uv, vec3 base) {
	vec3 hi = vec3(0.0);
	float wsum = 0.0;
	for (int i = 0; i < 6; i++) {
		float a = float(i) * 1.0472;
		vec2 off = vec2(cos(a), sin(a)) * 0.0036;
		vec3 s = sampleScene(uv + off);
		float lum = max(s.r, max(s.g, s.b));
		float w = smoothstep(0.72, 0.96, lum);
		hi += s * w;
		wsum += w;
	}
	if (wsum < 0.001) return base;
	float baseLum = max(base.r, max(base.g, base.b));
	float washGuard = 1.0 - smoothstep(0.65, 1.15, baseLum);
	float skyBoost = smoothstep(0.45, 0.78, uv.y);
	float amt = (0.12 + uPulse * 0.12 + uBoost * 0.06) * washGuard * (0.45 + skyBoost * 0.55);
	return base + (hi / wsum) * amt;
}

vec3 anamorphicStreak(vec2 uv, vec3 base) {
	float amt = (uPulse * 0.72 + uBoost * 0.28 + uChromaticBurst * 0.45)
		* (1.0 - uMenuMode);
	if (amt < 0.02) return base;
	vec3 streak = vec3(0.0);
	float wsum = 0.0;
	for (int i = -4; i <= 4; i++) {
		if (i == 0) continue;
		float f = float(i);
		float w = 1.0 - abs(f) / 5.0;
		vec3 s = sampleScene(uv + vec2(f * 0.0038 * amt, 0.0));
		float lum = max(s.r, max(s.g, s.b));
		float hw = w * smoothstep(0.55, 0.92, lum);
		streak += s * hw;
		wsum += hw;
	}
	if (wsum < 0.001) return base;
	vec3 tint = mix(vec3(0.55, 0.82, 1.0), vec3(1.0, 0.78, 0.45), uWarmGrade);
	return base + (streak / wsum) * tint * amt * 0.55;
}

void main() {
	vec2 uv = vUv;
	vec2 dir = uv - 0.5;
	float dist = length(dir);
	float menuCalm = 1.0 - uMenuMode;

	float lens =
		(uIntensity * 0.62 + uBoost * 0.85 + uPulse * 0.48) * menuCalm;
	vec2 sampleUv = uv + dir * dist * lens * 0.018;

	vec3 col = samplePremium(sampleUv);

	float aberration =
		(0.0006 + uIntensity * 0.0035 + uPulse * 0.004 + uChromaticBurst * 0.012)
		* menuCalm;
	vec2 ab = dir * aberration * (1.0 + uChromaticBurst * 0.5);
	float chromaMix = (0.22 + uChromaticBurst * 0.35) * menuCalm;
	float r = sampleScene(sampleUv + ab * (1.0 + uChromaticBurst * 0.7)).r;
	float b = sampleScene(sampleUv - ab * (1.0 + uChromaticBurst * 0.7)).b;
	col.r = mix(col.r, r, chromaMix);
	col.b = mix(col.b, b, chromaMix);

	col = softBloom(sampleUv, col);
	col = anamorphicStreak(sampleUv, col);

	if (uVignette > 0.001) {
		float vigAmt = mix(
			0.42 + uIntensity * 0.18 + uDoFStrength * 0.12,
			0.08 + uDoFStrength * 0.04,
			uMenuMode
		) * uVignette;
		float vig = 1.0 - dist * dist * vigAmt;
		col *= mix(smoothstep(0.04, 0.96, vig), smoothstep(0.02, 0.99, vig), uMenuMode);
	}

	float hotCore = (1.0 - smoothstep(0.0, 0.5, dist))
		* (uBoost * 0.08 + uPulse * 0.05) * menuCalm;
	col += col * hotCore;
	float edgeLift = smoothstep(0.35, 0.78, dist) * 0.035 * menuCalm;
	col += col * edgeLift * (0.4 + uIntensity * 0.6);

	float luma0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
	vec3 shadowTint = vec3(0.98, 1.02, 1.04);
	vec3 highTint = vec3(1.05, 1.02, 0.97);
	col = mix(col * shadowTint, col * highTint, smoothstep(0.12, 0.7, luma0));
	/** Lekki lift cieni — mniej „błotnistych” kolorów. */
	col += (1.0 - luma0) * vec3(0.018, 0.022, 0.02);

	vec3 coolTint = vec3(0.92, 0.98, 1.08);
	col = mix(col, col * coolTint + vec3(0.01, 0.02, 0.04), uCoolGrade * 0.28);

	vec3 warmTint = vec3(1.1, 1.03, 0.92);
	col = mix(col, col * warmTint + vec3(0.035, 0.016, 0.0), uWarmGrade * 0.32);

	col = mix(col, col * vec3(1.08, 1.02, 0.95), uBoost * 0.28);

	float pulseGlow = uPulse * (0.62 + 0.14 * sin(uTime * 18.0)) * menuCalm;
	col += vec3(0.04, 0.07, 0.11) * pulseGlow;
	col += vec3(0.08, 0.05, 0.02) * uWarmGrade * uPulse * 0.35;

	float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
	float satAmt = 1.1 + uIntensity * 0.1 + uPulse * 0.08 + uWarmGrade * 0.06;
	float mid = 1.0 - abs(luma - 0.45) * 1.5;
	col = mix(vec3(luma), col, mix(1.0, satAmt, clamp(mid, 0.0, 1.0)));

	vec3 blur = (
		sampleScene(sampleUv + vec2(0.0009, 0.0)) +
		sampleScene(sampleUv - vec2(0.0009, 0.0)) +
		sampleScene(sampleUv + vec2(0.0, 0.0009)) +
		sampleScene(sampleUv - vec2(0.0, 0.0009))
	) * 0.25;
	col += (col - blur) * (0.42 + uIntensity * 0.1) * menuCalm;

	// Grade only — ACES robi renderer (unikamy podwójnego tonemap → czarne auta).
	col *= 1.06 + uBoost * 0.025 + uPulse * 0.03;

	float grain = hash(uv * vec2(1920.0, 1080.0) + uTime * 37.0) - 0.5;
	col += grain * (0.008 + uIntensity * 0.005) * menuCalm;

	/** Soft knee highlight — kickoff / niebo nie wybielają całego kadru. */
	float peak = max(col.r, max(col.g, col.b));
	if (peak > 0.92) {
		float t = (peak - 0.92) / max(peak, 0.001);
		col = mix(col, col / (1.0 + (peak - 0.92) * 1.8), clamp(t, 0.0, 1.0));
	}

	gl_FragColor = vec4(col, 1.0);
}
`;

const CINEMATIC_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export type CinematicPostFx = {
	/** ShaderMaterial pod pmndrs ShaderPass (inputBuffer). */
	material: THREE.ShaderMaterial;
	/** Compat dla testów — te same uniformy co material. */
	pass: { uniforms: THREE.ShaderMaterial["uniforms"]; dispose: () => void };
	update: (
		dt: number,
		speedMps: number,
		boosting: boolean,
		pulse?: number,
		premium?: PremiumFxInput,
	) => void;
	pulseCool: (strength: number) => void;
	pulseWarm: (strength: number) => void;
	pulseChromatic: (strength: number) => void;
	setSustainedGrades: (cool: number, warm: number) => void;
	setMenuPresentation: (active: boolean) => void;
	setPremiumScale: (quality: GraphicsQuality) => void;
	/** Opt-in winieta post-FX (0–1). Domyślnie 0. */
	setVignette: (amount: number) => void;
	dispose: () => void;
};

export function createCinematicPostFx(): CinematicPostFx {
	const material = new THREE.ShaderMaterial({
		uniforms: {
			inputBuffer: { value: null },
			uTime: { value: 0 },
			uIntensity: { value: 0 },
			uBoost: { value: 0 },
			uPulse: { value: 0 },
			uChromaticBurst: { value: 0 },
			uFocusUv: { value: new THREE.Vector2(0.5, 0.5) },
			uDoFStrength: { value: 0 },
			uMotionBlurDir: { value: new THREE.Vector2(0, 0) },
			uMotionBlurStrength: { value: 0 },
			uCoolGrade: { value: 0 },
			uWarmGrade: { value: 0 },
			uPremiumScale: { value: 1 },
			uMenuMode: { value: 0 },
			uVignette: { value: 0 },
		},
		vertexShader: CINEMATIC_VERTEX,
		fragmentShader: CINEMATIC_FRAGMENT,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});

	let pulseDecay = 0;
	let chromaticBurstDecay = 0;
	let coolDecay = 0;
	let warmDecay = 0;
	let sustainedCool = 0;
	let sustainedWarm = 0;
	let dofSmoothed = 0;
	let motSmoothed = 0;

	const uniforms = material.uniforms;

	return {
		material,
		pass: {
			uniforms,
			dispose() {
				material.dispose();
			},
		},
		pulseCool(strength: number) {
			coolDecay = Math.max(coolDecay, strength);
		},
		pulseWarm(strength: number) {
			warmDecay = Math.max(warmDecay, strength);
		},
		pulseChromatic(strength: number) {
			chromaticBurstDecay = Math.max(chromaticBurstDecay, strength);
		},
		setSustainedGrades(cool: number, warm: number) {
			sustainedCool = cool;
			sustainedWarm = warm;
		},
		setMenuPresentation(active: boolean) {
			uniforms.uMenuMode!.value = active ? 1 : 0;
		},
		setPremiumScale(quality: GraphicsQuality) {
			uniforms.uPremiumScale!.value =
				quality === "low" ? 0 : quality === "medium" ? 0.55 : 1;
		},
		setVignette(amount: number) {
			uniforms.uVignette!.value = THREE.MathUtils.clamp(amount, 0, 1);
		},
		update(dt, speedMps, boosting, pulse = 0, premium) {
			pulseDecay = Math.max(pulseDecay, pulse);
			pulseDecay = Math.max(0, pulseDecay - dt * 1.85);
			chromaticBurstDecay = Math.max(0, chromaticBurstDecay - dt * 4.8);
			coolDecay = Math.max(0, coolDecay - dt * 2.2);
			warmDecay = Math.max(0, warmDecay - dt * 1.55);

			const menuMode = uniforms.uMenuMode!.value as number;
			uniforms.uTime!.value += dt;
			uniforms.uIntensity!.value = computeCinematicIntensity(
				speedMps,
				boosting,
				pulseDecay,
			);
			uniforms.uBoost!.value = THREE.MathUtils.lerp(
				uniforms.uBoost!.value as number,
				boosting ? 1 : 0,
				1 - Math.exp(-10 * dt),
			);
			uniforms.uPulse!.value = pulseDecay;
			uniforms.uChromaticBurst!.value = chromaticBurstDecay;
			uniforms.uCoolGrade!.value = Math.max(coolDecay, sustainedCool);
			uniforms.uWarmGrade!.value = Math.max(warmDecay, sustainedWarm);

			const targetDof = menuMode > 0.5 ? 0 : (premium?.dofStrength ?? 0);
			const targetMot = premium?.motionBlurStrength ?? 0;
			dofSmoothed = THREE.MathUtils.lerp(
				dofSmoothed,
				targetDof,
				1 - Math.exp(-10 * dt),
			);
			motSmoothed = THREE.MathUtils.lerp(
				motSmoothed,
				targetMot,
				1 - Math.exp(-14 * dt),
			);
			uniforms.uDoFStrength!.value = dofSmoothed;
			uniforms.uMotionBlurStrength!.value = motSmoothed;

			if (premium) {
				(uniforms.uFocusUv!.value as THREE.Vector2).copy(premium.focusUv);
				(uniforms.uMotionBlurDir!.value as THREE.Vector2).copy(
					premium.motionBlurDir,
				);
			}
		},
		dispose() {
			material.dispose();
		},
	};
}
