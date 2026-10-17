/**
 * Color wash / liquid-sky planes — NBA tip-off style half-field color + aerial sheet.
 * Daje czytelne RGB bez additive white-wash laserów.
 */
import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";

const WASH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WASH_FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uMix;
uniform float uOpacity;
uniform float uTime;
uniform float uPulse;
varying vec2 vUv;
varying vec3 vWorld;

void main() {
  float band = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
  float breathe = 0.85 + 0.15 * sin(uTime * 2.2 + vWorld.x * 0.05);
  vec3 col = mix(uColorA, uColorB, clamp(uMix, 0.0, 1.0));
  /** Lekki scan — nie mydło. */
  float scan = 0.7 + 0.3 * sin(vWorld.z * 0.08 - uTime * 3.0 + uPulse);
  float alpha = uOpacity * band * breathe * scan;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.55));
}
`;

const SHEET_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uPulse;
varying vec2 vUv;
varying vec3 vWorld;

void main() {
  float radial = 1.0 - smoothstep(0.15, 0.95, length(vUv - 0.5) * 1.6);
  float swirl = sin(vWorld.x * 0.04 + uTime * 1.4) * sin(vWorld.z * 0.035 - uTime * 1.1);
  float mask = radial * (0.75 + 0.25 * swirl + uPulse * 0.12);
  float alpha = uOpacity * mask;
  if (alpha < 0.008) discard;
  /** Zachowaj chroma — zero white add. */
  gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 0.42));
}
`;

/**
 * Half-field team washes + aerial liquid-sky sheet.
 */
export class StadiumColorWash {
	readonly root = new THREE.Group();
	private readonly blueMat: THREE.ShaderMaterial;
	private readonly orangeMat: THREE.ShaderMaterial;
	private readonly sheetMat: THREE.ShaderMaterial;
	private readonly blue: THREE.Mesh;
	private readonly orange: THREE.Mesh;
	private readonly sheet: THREE.Mesh;

	constructor() {
		this.root.name = "stadiumColorWash";
		const hw = RL_ARENA.HALF_WIDTH;
		const hl = RL_ARENA.HALF_LENGTH;

		this.blueMat = new THREE.ShaderMaterial({
			uniforms: {
				uColorA: { value: new THREE.Color(0.05, 0.45, 1.35) },
				uColorB: { value: new THREE.Color(0.15, 0.85, 1.85) },
				uMix: { value: 0.35 },
				uOpacity: { value: 0 },
				uTime: { value: 0 },
				uPulse: { value: 0 },
			},
			vertexShader: WASH_VERT,
			fragmentShader: WASH_FRAG,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		this.orangeMat = this.blueMat.clone();
		this.orangeMat.uniforms = {
			uColorA: { value: new THREE.Color(1.45, 0.35, 0.05) },
			uColorB: { value: new THREE.Color(1.85, 0.75, 0.08) },
			uMix: { value: 0.4 },
			uOpacity: { value: 0 },
			uTime: { value: 0 },
			uPulse: { value: 0 },
		};

		const halfGeo = new THREE.PlaneGeometry(hw * 1.05, hl * 1.9, 1, 1);
		this.blue = new THREE.Mesh(halfGeo, this.blueMat);
		this.orange = new THREE.Mesh(halfGeo.clone(), this.orangeMat);
		for (const m of [this.blue, this.orange]) {
			m.rotation.x = -Math.PI * 0.5;
			m.position.y = PLAYFIELD_SURFACE_Y + 0.04;
			m.renderOrder = 6;
			m.frustumCulled = false;
		}
		this.blue.position.x = -hw * 0.52;
		this.orange.position.x = hw * 0.52;
		this.root.add(this.blue, this.orange);

		this.sheetMat = new THREE.ShaderMaterial({
			uniforms: {
				uColor: { value: new THREE.Color(1.2, 0.2, 1.55) },
				uOpacity: { value: 0 },
				uTime: { value: 0 },
				uPulse: { value: 0 },
			},
			vertexShader: WASH_VERT,
			fragmentShader: SHEET_FRAG,
			transparent: true,
			depthWrite: false,
			depthTest: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		this.sheet = new THREE.Mesh(
			new THREE.PlaneGeometry(hw * 2.1, hl * 2.1, 1, 1),
			this.sheetMat,
		);
		this.sheet.rotation.x = -Math.PI * 0.5;
		this.sheet.position.y = PLAYFIELD_SURFACE_Y + 9.5;
		this.sheet.renderOrder = 16;
		this.sheet.frustumCulled = false;
		this.root.add(this.sheet);
	}

	/**
	 * @param showU 0..1
	 * @param pulse music pulse
	 */
	update(t: number, showU: number, pulse: number): void {
		const team =
			THREE.MathUtils.smoothstep(showU, 0.1, 0.22) *
			(1 - THREE.MathUtils.smoothstep(showU, 0.82, 0.95));
		const liquid =
			THREE.MathUtils.smoothstep(showU, 0.26, 0.4) *
			(1 - THREE.MathUtils.smoothstep(showU, 0.7, 0.88));
		const drop =
			THREE.MathUtils.smoothstep(showU, 0.46, 0.52) *
			(1 - THREE.MathUtils.smoothstep(showU, 0.66, 0.78));

		const floorOp = Math.min(0.42, team * (0.28 + pulse * 0.08) + drop * 0.12);
		this.blueMat.uniforms.uOpacity!.value = floorOp;
		this.orangeMat.uniforms.uOpacity!.value = floorOp;
		this.blueMat.uniforms.uTime!.value = t;
		this.orangeMat.uniforms.uTime!.value = t;
		this.blueMat.uniforms.uPulse!.value = pulse;
		this.orangeMat.uniforms.uPulse!.value = pulse;
		this.blueMat.uniforms.uMix!.value = 0.3 + pulse * 0.25;
		this.orangeMat.uniforms.uMix!.value = 0.35 + pulse * 0.2;

		/** Liquid sky sheet — magenta → gold → cyan cycle. */
		const huePhase = showU * 6.5 + t * 0.35;
		const sheetCol = this.sheetMat.uniforms.uColor!.value as THREE.Color;
		sheetCol.setHSL(
			(0.78 + Math.sin(huePhase) * 0.12 + drop * 0.08) % 1,
			0.95,
			0.55,
		);
		/** Boost saturation via HDR channels without whitening. */
		sheetCol.r *= 1.35;
		sheetCol.g *= 1.15;
		sheetCol.b *= 1.45;
		this.sheetMat.uniforms.uOpacity!.value = Math.min(
			0.38,
			liquid * (0.22 + pulse * 0.1) + drop * 0.18,
		);
		this.sheetMat.uniforms.uTime!.value = t;
		this.sheetMat.uniforms.uPulse!.value = pulse;
		this.sheet.visible = (this.sheetMat.uniforms.uOpacity!.value as number) > 0.02;
		this.blue.visible = floorOp > 0.02;
		this.orange.visible = floorOp > 0.02;
	}

	dispose(): void {
		this.blue.geometry.dispose();
		this.orange.geometry.dispose();
		this.sheet.geometry.dispose();
		this.blueMat.dispose();
		this.orangeMat.dispose();
		this.sheetMat.dispose();
		this.root.removeFromParent();
	}
}
