import * as THREE from "three";
import { resolveArenaNeonHex } from "../arena/arenaNeonAccent";
import {
	getCachedMeshyTexture,
	getMeshyArenaManifest,
	resolveMeshyTexture,
} from "./meshyArenaAssets";

const WALL_BASE = 0x0a1128;

const wallMaterials: THREE.ShaderMaterial[] = [];
let atmosphereLineBoost = 0;

const WALL_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec2 vPanelUv;

uniform float uPanelScale;

void main() {
	vec4 wp = modelMatrix * vec4(position, 1.0);
	vWorldPos = wp.xyz;
	vPanelUv = wp.xz * uPanelScale;
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
uniform sampler2D uPanelTex;
uniform float uPanelMix;

varying vec3 vWorldPos;
varying vec2 vPanelUv;

float hexDist(vec2 p) {
	p = abs(p);
	return max(p.x * 0.866025 + p.y * 0.5, p.y);
}

void main() {
	/** Hex grid na ścianie (RL motif). */
	vec2 hp = vec2(
		vWorldPos.x * 0.55 + vWorldPos.z * 0.55,
		vWorldPos.y
	) * uGridScale;
	hp.x *= 1.1547;
	float row = floor(hp.y);
	hp.x += mod(row, 2.0) * 0.5;
	vec2 cell = fract(hp) - 0.5;
	float hd = hexDist(cell);
	float fw = fwidth(hd) * 1.7;
	float hexLine = 1.0 - smoothstep(0.44, 0.44 + fw, hd);

	float pulse = 0.78 + 0.22 * sin(uTime * 2.1 + vWorldPos.y * 0.16);
	float alpha = uBaseOpacity + hexLine * uLineBoost * pulse;
	vec3 col = mix(uBaseColor, uGridColor, hexLine * 0.72 * pulse);

	vec3 panel = texture2D(uPanelTex, vPanelUv).rgb;
	col = mix(col, panel * 0.7 + uGridColor * 0.14, uPanelMix);

	gl_FragColor = vec4(col, alpha);
}
`;

/** Półprzezroczyste ściany z neonową siatką + opcjonalna tekstura Meshy. */
export function createNeonWallMaterial(): THREE.ShaderMaterial {
	const manifest = getMeshyArenaManifest();
	const hasPanel = !!manifest?.wallPanel;
	const cached = getCachedMeshyTexture("wallPanel");
	const panelTex =
		cached ??
		(hasPanel
			? new THREE.TextureLoader().load(resolveMeshyTexture("wallPanel", ""))
			: new THREE.DataTexture(new Uint8Array([10, 17, 40, 255]), 1, 1));
	panelTex.wrapS = THREE.RepeatWrapping;
	panelTex.wrapT = THREE.RepeatWrapping;
	panelTex.colorSpace = THREE.SRGBColorSpace;
	panelTex.needsUpdate = true;

	const mat = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uGridColor: { value: new THREE.Color(resolveArenaNeonHex()) },
			uBaseColor: { value: new THREE.Color(WALL_BASE) },
			uGridScale: { value: 0.42 },
			uBaseOpacity: { value: hasPanel ? 0.3 : 0.26 },
			uLineBoost: { value: hasPanel ? 0.32 : 0.28 },
			uPanelTex: { value: panelTex },
			uPanelMix: { value: hasPanel ? 0.38 : 0 },
			uPanelScale: { value: 0.038 },
		},
		vertexShader: WALL_VERTEX,
		fragmentShader: WALL_FRAGMENT,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	mat.userData.baseLineBoost = hasPanel ? 0.38 : 0.34;
	mat.userData.baseOpacity = hasPanel ? 0.3 : 0.26;
	wallMaterials.push(mat);
	return mat;
}

export function setNeonWallAtmosphereBoost(boost: number): void {
	atmosphereLineBoost = THREE.MathUtils.clamp(boost, 0, 1.5);
}

/** Menu orbit — cichsza siatka (bez „god ray” smug przez kadr). */
export function setNeonWallMenuCalm(calm: boolean): void {
	for (const mat of wallMaterials) {
		const base = (mat.userData.baseLineBoost as number | undefined) ?? 0.24;
		const baseOpacity =
			(mat.userData.baseOpacity as number | undefined) ?? 0.26;
		if (calm) {
			mat.uniforms.uBaseOpacity.value = baseOpacity * 0.55;
			mat.userData.menuCalm = true;
			mat.userData.baseLineBoostMenu = base * 0.35;
		} else {
			mat.uniforms.uBaseOpacity.value = baseOpacity;
			mat.userData.menuCalm = false;
			delete mat.userData.baseLineBoostMenu;
		}
	}
}

/** Kolor neonu band z aktywnej mapy (arena-catalog atmosphere.neonAccent). */
export function setArenaNeonAccent(accent?: string): void {
	const hex = resolveArenaNeonHex(accent);
	const color = new THREE.Color(hex);
	for (const mat of wallMaterials) {
		mat.uniforms.uGridColor.value.copy(color);
	}
}

export function updateNeonWallMaterials(timeSec: number): void {
	for (const mat of wallMaterials) {
		mat.uniforms.uTime.value = timeSec;
		const base =
			(mat.userData.baseLineBoostMenu as number | undefined) ??
			(mat.userData.baseLineBoost as number | undefined) ??
			0.24;
		mat.uniforms.uLineBoost.value = base * (1 + atmosphereLineBoost * 0.5);
	}
}
