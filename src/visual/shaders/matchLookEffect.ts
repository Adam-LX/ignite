import { BlendFunction, Effect } from "postprocessing";
import { Uniform, Vector2 } from "three";

/**
 * Premium match look (pmndrs Effect) — ACES-ish, sharpen, anamorphic, bloom local.
 * Bez winiety.
 */
const FRAG = /* glsl */ `
uniform float uSharpen;
uniform float uGrade;
uniform float uLens;
uniform float uSpectacle;
uniform vec2 uTexel;

vec3 acesTonemap(vec3 x) {
	const float a = 2.51;
	const float b = 0.03;
	const float c = 2.43;
	const float d = 0.59;
	const float e = 0.14;
	return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
	vec2 dir = uv - 0.5;
	float dist = length(dir);
	vec2 sampleUv = uv + dir * dist * uLens * 0.016;

	vec3 col = texture2D(inputBuffer, sampleUv).rgb;

	// Soft highlight bloom (lokalny).
	vec3 bloom = vec3(0.0);
	float bw = 0.0;
	for (int i = 0; i < 6; i++) {
		float a = float(i) * 1.0472;
		vec2 off = vec2(cos(a), sin(a)) * 0.005;
		vec3 s = texture2D(inputBuffer, sampleUv + off).rgb;
		float lum = max(s.r, max(s.g, s.b));
		float w = smoothstep(0.6, 0.95, lum);
		bloom += s * w;
		bw += w;
	}
	if (bw > 0.001) {
		col += (bloom / bw) * (0.16 + uSpectacle * 0.28);
	}

	// Anamorphic streak na spektakl.
	if (uSpectacle > 0.05) {
		vec3 streak = vec3(0.0);
		float sw = 0.0;
		for (int i = -3; i <= 3; i++) {
			if (i == 0) continue;
			float f = float(i);
			float w = 1.0 - abs(f) / 4.0;
			vec3 s = texture2D(inputBuffer, sampleUv + vec2(f * 0.004 * uSpectacle, 0.0)).rgb;
			float lum = max(s.r, max(s.g, s.b));
			float hw = w * smoothstep(0.55, 0.9, lum);
			streak += s * hw;
			sw += hw;
		}
		if (sw > 0.001) {
			col += (streak / sw) * vec3(0.7, 0.88, 1.0) * uSpectacle * 0.45;
		}
	}

	if (uSharpen > 0.001) {
		vec3 blur = (
			texture2D(inputBuffer, sampleUv + vec2(uTexel.x, 0.0)).rgb +
			texture2D(inputBuffer, sampleUv - vec2(uTexel.x, 0.0)).rgb +
			texture2D(inputBuffer, sampleUv + vec2(0.0, uTexel.y)).rgb +
			texture2D(inputBuffer, sampleUv - vec2(0.0, uTexel.y)).rgb
		) * 0.25;
		col += (col - blur) * uSharpen;
	}

	float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
	vec3 shadows = vec3(0.90, 0.97, 1.08);
	vec3 highlights = vec3(1.06, 1.01, 0.94);
	vec3 graded = mix(col * shadows, col * highlights, smoothstep(0.15, 0.75, luma));
	col = mix(inputColor.rgb, graded, uGrade);

	float hot = (1.0 - smoothstep(0.0, 0.5, dist)) * uSpectacle * 0.07;
	col += col * hot;

	col = acesTonemap(col * (1.04 + uSpectacle * 0.08));
	outputColor = vec4(col, inputColor.a);
}
`;

export class MatchLookEffect extends Effect {
	constructor() {
		const uniforms = new Map<string, Uniform>();
		uniforms.set("uSharpen", new Uniform(0.46));
		uniforms.set("uGrade", new Uniform(0.62));
		uniforms.set("uLens", new Uniform(0));
		uniforms.set("uSpectacle", new Uniform(0));
		uniforms.set("uTexel", new Uniform(new Vector2(1 / 1920, 1 / 1080)));

		super("MatchLookEffect", FRAG, {
			blendFunction: BlendFunction.NORMAL,
			uniforms,
		});
	}

	setSize(width: number, height: number): void {
		const texel = this.uniforms.get("uTexel")!.value as Vector2;
		texel.set(1 / Math.max(1, width), 1 / Math.max(1, height));
	}

	setSpectacle(amount: number): void {
		const a = Math.max(0, Math.min(1.4, amount));
		this.uniforms.get("uSharpen")!.value = 0.4 + a * 0.32;
		this.uniforms.get("uGrade")!.value = 0.55 + a * 0.25;
		this.uniforms.get("uLens")!.value = a * 0.9;
		this.uniforms.get("uSpectacle")!.value = a;
	}
}
