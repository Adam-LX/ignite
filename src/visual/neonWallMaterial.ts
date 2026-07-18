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

	vec3 panel = texture2D(uPanelTex, vPanelUv).rgb;
	col = mix(col, panel * 0.85 + uGridColor * 0.15, uPanelMix);

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
			uGridScale: { value: 0.55 },
			uBaseOpacity: { value: hasPanel ? 0.34 : 0.26 },
			uLineBoost: { value: hasPanel ? 0.28 : 0.22 },
			uPanelTex: { value: panelTex },
			uPanelMix: { value: hasPanel ? 0.52 : 0 },
			uPanelScale: { value: 0.038 },
		},
		vertexShader: WALL_VERTEX,
		fragmentShader: WALL_FRAGMENT,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	mat.userData.baseLineBoost = hasPanel ? 0.28 : 0.22;
	mat.userData.baseOpacity = hasPanel ? 0.34 : 0.26;
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
		mat.uniforms.uLineBoost.value = base * (1 + atmosphereLineBoost * 0.85);
	}
}
