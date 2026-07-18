import * as THREE from "three";

const MAX_LIGHTS = 8;

/**
 * Post-process lens flare (pmndrs ShaderPass) — bez THREE.Lensflare.
 * Ghosts + soft halo w kierunku środka kadru.
 */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D inputBuffer;
uniform float uIntensity;
uniform float uCount;
uniform vec4 uLights[8]; // xy = uv, z = strength, w = unused
uniform vec3 uColors[8];

varying vec2 vUv;

vec3 flareForLight(vec2 uv, vec2 lightUv, float strength, vec3 tint) {
	if (strength < 0.01) return vec3(0.0);
	vec2 toLight = lightUv - 0.5;
	float distToCenter = length(toLight);
	/**
	 * Stadion: jupitery są na brzegach nieba — nie gasimy ich edge falloffem.
	 * Tylko ekstremalne rogi lekko ściszamy.
	 */
	float onScreen = smoothstep(1.35, 0.55, distToCenter);
	float skyBoost = smoothstep(0.15, 0.9, lightUv.y) * 0.55 + 0.85;
	float s = strength * onScreen * skyBoost * uIntensity;
	if (s < 0.01) return vec3(0.0);

	vec3 acc = vec3(0.0);
	vec2 dir = lightUv - uv;

	// Core halo — czytelny „żywy” stadion
	float d = length(uv - lightUv);
	acc += tint * s * 0.85 * exp(-d * 16.0);
	acc += tint * s * 0.38 * exp(-d * 5.8);
	acc += tint * s * 0.14 * exp(-d * 2.4);

	// Anamorphic streak
	float streak = exp(-abs(dir.y) * 40.0) * exp(-abs(dir.x) * 2.2);
	acc += tint * s * 0.32 * streak;

	// Ghosts wzdłuż linii light → środek
	vec2 ghostDir = 0.5 - lightUv;
	for (int i = 1; i <= 5; i++) {
		float t = float(i) * 0.18;
		vec2 gp = lightUv + ghostDir * t;
		float gd = length(uv - gp);
		float g = exp(-gd * (12.0 + float(i) * 4.5));
		acc += tint * s * g * (0.22 / float(i));
	}

	// Hex sparkle + secondary ring
	float spark = pow(max(0.0, 1.0 - d * 9.0), 4.5);
	acc += vec3(1.0) * s * spark * 0.22;
	float ring = exp(-abs(d - 0.045) * 55.0);
	acc += tint * s * ring * 0.12;

	return acc;
}

void main() {
	vec3 col = texture2D(inputBuffer, vUv).rgb;
	vec3 flare = vec3(0.0);
	int n = int(uCount + 0.5);
	for (int i = 0; i < 8; i++) {
		if (i >= n) break;
		flare += flareForLight(vUv, uLights[i].xy, uLights[i].z, uColors[i]);
	}
	/** Soft ceiling — flary żyją, ale nie wybielają całego kadru (kickoff / snop). */
	flare = flare / (vec3(1.0) + flare * 2.2);
	flare = min(flare, vec3(0.38));
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
	const colors = Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3(1, 1, 1));

	const material = new THREE.ShaderMaterial({
		uniforms: {
			inputBuffer: { value: null },
			uIntensity: { value: 1.15 },
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
			material.uniforms.uIntensity!.value = THREE.MathUtils.clamp(v, 0, 2.8);
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
