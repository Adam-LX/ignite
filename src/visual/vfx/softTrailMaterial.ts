import * as THREE from "three";

const VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;

void main() {
	vUv = uv;
	vec3 nView = normalize(normalMatrix * normal);
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	vFacing = abs(dot(nView, normalize(-mv.xyz)));
	gl_Position = projectionMatrix * mv;
}
`;

/**
 * Boost jet / soft trail — hot core + noise flicker + miękki bloom.
 * UV.y = wzdłuż strumienia (0 = dysza, 1 = koniec), UV.x = szerokość.
 * uConeMode: 1 = otwarty stożek (cylinder) — bez planar edge = żółty klocek.
 */
const FRAG = /* glsl */ `
uniform vec3 uColorHead;
uniform vec3 uColorMid;
uniform vec3 uColorTail;
uniform float uOpacity;
uniform float uGlowPower;
uniform float uTime;
uniform float uPulse;
uniform float uConeMode;

varying vec2 vUv;
varying float vFacing;

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float a = hash21(i);
	float b = hash21(i + vec2(1.0, 0.0));
	float c = hash21(i + vec2(0.0, 1.0));
	float d = hash21(i + vec2(1.0, 1.0));
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
	float along = vUv.y;
	float edge = abs(vUv.x - 0.5) * 2.0;

	/** Turbulencja wzdłuż strumienia. */
	float n = noise(vec2(vUv.x * 6.0, along * 14.0 - uTime * 18.0));
	float n2 = noise(vec2(vUv.x * 3.0 + 2.1, along * 7.0 - uTime * 9.5));
	float flicker = mix(0.82, 1.22, n) * mix(0.9, 1.12, n2);
	flicker *= 0.88 + 0.22 * uPulse;

	float coreW;
	float bloomW;
	float facingMul = 1.0;
	if (uConeMode > 0.5) {
		/**
		 * Cylinder UV.x = obwód — planar edge robi jasny pas → additive „klocek”.
		 * Profil = długość + lekki scallop + facing (cieniej patrząc wzdłuż osi).
		 */
		edge = 0.22 + 0.28 * abs(sin(vUv.x * 6.2831853 * 2.0));
		coreW = mix(0.95, 0.55, along);
		bloomW = mix(0.55, 0.22, along);
		facingMul = mix(0.22, 1.0, pow(clamp(vFacing, 0.0, 1.0), 0.55));
	} else {
		coreW = mix(0.28, 0.1, along);
		bloomW = mix(0.48, 0.22, along);
	}

	float core = pow(1.0 - clamp(edge / max(coreW, 0.02), 0.0, 1.0), 3.2);
	float bloom = pow(1.0 - clamp(edge / max(bloomW, 0.02), 0.0, 1.0), uGlowPower);

	float softCap = smoothstep(0.0, 0.06, along) * smoothstep(1.05, 0.42, along);
	/** Lekkie „pierścienie” Macha. */
	float rings = sin(along * 42.0 - uTime * 28.0) * 0.5 + 0.5;
	rings = mix(1.0, 0.75 + rings * 0.45, smoothstep(0.1, 0.55, along));

	vec3 hot = mix(uColorHead, vec3(1.15, 1.12, 1.05), core * 0.75);
	vec3 mid = mix(uColorTail, uColorMid, pow(along, 0.55));
	vec3 col = mix(mid, hot, core * 0.85 + bloom * 0.22);
	col *= flicker * rings;

	float bloomA = uConeMode > 0.5 ? 0.28 : 0.4;
	float alpha = uOpacity * (core * 1.1 + bloom * bloomA) * softCap * flicker * facingMul;
	alpha = clamp(alpha, 0.0, 1.0);
	if (alpha < 0.004) discard;
	gl_FragColor = vec4(col, alpha);
}
`;

/** Miękka smuga z radialnym rozmyciem — additive, niska bazowa krycie. */
export function createSoftTrailMaterial(
	glowPower = 1.85,
	coneMode = false,
): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: {
			uColorHead: { value: new THREE.Color(0xaaffff) },
			uColorMid: { value: new THREE.Color(0xffaa44) },
			uColorTail: { value: new THREE.Color(0xff66cc) },
			uOpacity: { value: 0.42 },
			uGlowPower: { value: glowPower },
			uTime: { value: 0 },
			uPulse: { value: 0 },
			uConeMode: { value: coneMode ? 1 : 0 },
		},
		vertexShader: VERT,
		fragmentShader: FRAG,
		transparent: true,
		depthWrite: false,
		depthTest: true,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		fog: false,
		toneMapped: false,
	});
}

export function setSoftTrailColors(
	mat: THREE.ShaderMaterial,
	head: THREE.Color,
	tail: THREE.Color,
	opacity: number,
	mid?: THREE.Color,
): void {
	mat.uniforms.uColorHead!.value.copy(head);
	mat.uniforms.uColorTail!.value.copy(tail);
	if (mid) {
		mat.uniforms.uColorMid!.value.copy(mid);
	} else {
		(mat.uniforms.uColorMid!.value as THREE.Color)
			.copy(head)
			.lerp(tail, 0.45);
	}
	mat.uniforms.uOpacity!.value = opacity;
}

export function setSoftTrailAnim(
	mat: THREE.ShaderMaterial,
	time: number,
	pulse: number,
): void {
	mat.uniforms.uTime!.value = time;
	mat.uniforms.uPulse!.value = THREE.MathUtils.clamp(pulse, 0, 1.5);
}
