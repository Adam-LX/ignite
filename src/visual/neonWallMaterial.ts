import * as THREE from "three";

const WALL_GLOW = 0x9adcff;
const WALL_BASE = 0x0a1128;

const wallMaterials: THREE.ShaderMaterial[] = [];

const WALL_VERTEX = /* glsl */ `
varying vec3 vWorldPos;

void main() {
	vec4 wp = modelMatrix * vec4(position, 1.0);
	vWorldPos = wp.xyz;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WALL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uGridColor;
uniform vec3 uBaseColor;
uniform float uGridScale;
uniform float uBaseOpacity;
uniform float uLineBoost;

varying vec3 vWorldPos;

void main() {
	float horiz = vWorldPos.y * uGridScale;
	float vert = (vWorldPos.x * 0.62 + vWorldPos.z * 0.62) * uGridScale;

	float fh = abs(fract(horiz - 0.5) - 0.5);
	float fv = abs(fract(vert - 0.5) - 0.5);
	float lineH = 1.0 - smoothstep(0.0, fwidth(horiz) * 1.6, fh);
	float lineV = 1.0 - smoothstep(0.0, fwidth(vert) * 1.6, fv);
	float grid = max(lineH, lineV);

	float pulse = 0.9 + 0.1 * sin(uTime * 1.6 + vWorldPos.y * 0.18);
	float alpha = uBaseOpacity + grid * uLineBoost * pulse;
	vec3 col = mix(uBaseColor, uGridColor, grid * 0.5 * pulse);

	gl_FragColor = vec4(col, alpha);
}
`;

/** Półprzezroczyste ściany z delikatną neonową siatką (skybox prześwituje). */
export function createNeonWallMaterial(): THREE.ShaderMaterial {
	const mat = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uGridColor: { value: new THREE.Color(WALL_GLOW) },
			uBaseColor: { value: new THREE.Color(WALL_BASE) },
			uGridScale: { value: 0.55 },
			uBaseOpacity: { value: 0.2 },
			uLineBoost: { value: 0.32 },
		},
		vertexShader: WALL_VERTEX,
		fragmentShader: WALL_FRAGMENT,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	wallMaterials.push(mat);
	return mat;
}

export function updateNeonWallMaterials(timeSec: number): void {
	for (const mat of wallMaterials) {
		mat.uniforms.uTime.value = timeSec;
	}
}
