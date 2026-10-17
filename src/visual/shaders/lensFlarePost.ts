import * as THREE from "three";

const MAX_LIGHTS = 8;

/**
 * Post-process lens flare — snopy + flary + hex bokeh odbijające się w obiektywie.
 * Skybox chroniony twardym ceiling; zero soft white wash.
 */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uIntensity;
uniform float uCount;
uniform vec4 uLights[8]; // xy = uv, z = strength, w = unused
uniform vec3 uColors[8];

varying vec2 vUv;

/** Przybliżony hex (iris / anamorphic bokeh). */
float hexDist(vec2 p) {
	p = abs(p);
	return max(p.x * 0.866025 + p.y * 0.5, p.y);
}

vec3 flareForLight(vec2 uv, vec2 lightUv, float strength, vec3 tint) {
	if (strength < 0.01) return vec3(0.0);
	vec2 toLight = lightUv - 0.5;
	float distToCenter = length(toLight);
	float onScreen = smoothstep(1.6, 0.45, distToCenter);
	float s = strength * onScreen * uIntensity;
	if (s < 0.01) return vec3(0.0);

	vec3 acc = vec3(0.0);
	vec2 dir = lightUv - uv;
	float d = length(uv - lightUv);
	/** Lekki boost przy osi — nie nuklearny wash (klip 00-33). */
	float camHit = 1.0 + (1.0 - smoothstep(0.1, 0.55, distToCenter)) * 0.55;

	/** Hot core + cienki halo. */
	acc += tint * s * 1.22 * camHit * exp(-d * 52.0);
	acc += tint * s * 0.36 * camHit * exp(-d * 22.0);
	acc += tint * s * 0.12 * exp(-d * 10.0);

	/** Anamorphic streak. */
	float hzMute = 1.0 - pow(clamp(1.0 - abs(uv.y - 0.52) * 3.6, 0.0, 1.0), 1.4) * 0.7;
	float skyMute = 1.0 - smoothstep(0.52, 0.88, uv.y) * 0.4;
		float streak = exp(-abs(dir.y) * 82.0) * exp(-abs(dir.x) * 3.8);
	acc += tint * s * 0.2 * streak * hzMute * skyMute * camHit;
	float streakV = exp(-abs(dir.x) * 90.0) * exp(-abs(dir.y) * 4.2);
	acc += tint * s * 0.07 * streakV * skyMute;

	vec2 ghostDir = 0.5 - lightUv;
	vec2 rayDir = normalize(ghostDir + vec2(1e-4));
	float alongRay = dot(uv - lightUv, rayDir);
	float acrossRay = abs(dot(uv - lightUv, vec2(-rayDir.y, rayDir.x)));
	float rayMask = smoothstep(0.0, 0.012, alongRay) * smoothstep(0.48, 0.05, alongRay);
	float rayCore = exp(-acrossRay * 105.0) * rayMask;
	acc += tint * s * rayCore * 0.55 * skyMute * camHit;

	/** Małe hex ghosty — czytelne, nie wielkie bąble na aucie. */
	for (int i = 1; i <= 5; i++) {
		float t = float(i) * 0.16;
		vec2 gp = lightUv + ghostDir * t;
		float scale = 0.006 + float(i) * 0.0028;
		float hd = hexDist((uv - gp) / scale);
		float orb = 1.0 - smoothstep(0.75, 1.05, hd);
		float fade = 0.17 / float(i);
		acc += tint * s * orb * fade * 0.52 * skyMute * camHit;
		float gd = length(uv - gp);
		acc += tint * s * exp(-gd * (28.0 + float(i) * 8.0)) * (0.08 / float(i));
	}

	float spark = pow(max(0.0, 1.0 - d * 14.0), 5.0);
	acc += vec3(1.05, 1.0, 0.95) * s * spark * 0.22 * camHit;
	float ring = exp(-abs(d - 0.024) * 80.0);
	acc += tint * s * ring * 0.08;

	return acc;
}

void main() {
	vec3 col = texture2D(tDiffuse, vUv).rgb;
	vec3 flare = vec3(0.0);
	int n = int(uCount + 0.5);
	for (int i = 0; i < 8; i++) {
		if (i >= n) break;
		flare += flareForLight(vUv, uLights[i].xy, uLights[i].z, uColors[i]);
	}
	/** Twarde ceiling — zero prania kadru. */
	float sky = smoothstep(0.48, 0.85, vUv.y);
	flare = flare / (vec3(1.0) + flare * 3.2);
	flare = min(flare, mix(vec3(0.32), vec3(0.14), sky));
	col += flare;
	gl_FragColor = vec4(col, 1.0);
}
`;

export type LensFlareLight = {
	/** NDC-ish UV 0–1 */
	uv: THREE.Vector2;
	strength: number;
	color: THREE.Color;
};

export type LensFlarePost = {
	material: THREE.ShaderMaterial;
	setLights: (lights: LensFlareLight[]) => void;
	setIntensity: (v: number) => void;
	dispose: () => void;
};

export function createLensFlarePost(): LensFlarePost {
	const lights = Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4());
	const colors = Array.from(
		{ length: MAX_LIGHTS },
		() => new THREE.Vector3(1, 1, 1),
	);

	const material = new THREE.ShaderMaterial({
		uniforms: {
			tDiffuse: { value: null },
			uIntensity: { value: 0.72 },
			uCount: { value: 0 },
			uLights: { value: lights },
			uColors: { value: colors },
		},
		vertexShader: VERT,
		fragmentShader: FRAG,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});

	return {
		material,
		setIntensity(v) {
			material.uniforms.uIntensity!.value = THREE.MathUtils.clamp(v, 0, 1.8);
		},
		setLights(list) {
			const n = Math.min(MAX_LIGHTS, list.length);
			material.uniforms.uCount!.value = n;
			for (let i = 0; i < MAX_LIGHTS; i++) {
				if (i < n) {
					const L = list[i]!;
					lights[i]!.set(L.uv.x, L.uv.y, L.strength, 0);
					colors[i]!.set(L.color.r, L.color.g, L.color.b);
				} else {
					lights[i]!.set(0, 0, 0, 0);
				}
			}
		},
		dispose() {
			material.dispose();
		},
	};
}

export { MAX_LIGHTS };
