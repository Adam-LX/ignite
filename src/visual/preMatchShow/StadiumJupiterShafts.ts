/**
 * Prematch — rozproszone snopy jupiterów (floodlights).
 * Billboard + miękki falloff + noise: krawędzie rozmywają się w atmosferze
 * (bez płaskich stożków / „ścian światła”).
 */
import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y } from "../arenaConstants";
import { STADIUM_PYLON_SPECS } from "../stadiumPylons";

const SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Szeroki volumetric flood — rdzeń ledwie cieplejszy, brzegi w haze.
 * Noise + soft edge = brak płaskiej powierzchni.
 */
const SHAFT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uGain;
uniform float uTime;
uniform float uSeed;
uniform float uPulse;
varying vec2 vUv;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i.x + i.y * 57.0);
  float b = hash(i.x + 1.0 + i.y * 57.0);
  float c = hash(i.x + (i.y + 1.0) * 57.0);
  float d = hash(i.x + 1.0 + (i.y + 1.0) * 57.0);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  float edge = abs(vUv.x - 0.5) * 2.0;
  /** Miękki rdzeń — nie igła laserowa. */
  float core = pow(1.0 - clamp(edge / 0.42, 0.0, 1.0), 2.1);
  /** Szeroki bloom → rozpuszczenie w powietrzu. */
  float bloom = pow(1.0 - clamp(edge, 0.0, 1.0), 1.55) * 0.72;
  /** Outer veil — prawie niewidoczny, gubi krawędź. */
  float veil = pow(1.0 - clamp(edge / 1.05, 0.0, 1.0), 1.15) * 0.38;

  float n = noise(vec2(vUv.y * 9.0 + uTime * 0.35 + uSeed, edge * 3.2 + uTime * 0.12));
  float n2 = noise(vec2(vUv.y * 3.5 - uTime * 0.18 + uSeed * 2.1, edge * 1.4));
  /** Edge dissolve — krawędź „wyparowuje” w haze. */
  float edgeKill = smoothstep(0.55, 1.05, edge + n * 0.28 + n2 * 0.12);
  float mottled = mix(0.72, 1.18, n) * mix(0.88, 1.08, n2);

  float along =
    smoothstep(0.0, 0.08, vUv.y) *
    smoothstep(1.05, 0.55, vUv.y);
  along *= 0.75 + 0.25 * sin(clamp(vUv.y, 0.0, 1.0) * 3.14159);
  /** Lekki drift jasności wzdłuż snopa. */
  along *= mix(0.9, 1.12, noise(vec2(vUv.y * 14.0 - uTime * 0.55, uSeed)));

  float radial = max(core, max(bloom, veil)) * mottled;
  radial *= 1.0 - edgeKill * 0.92;
  float breath = 0.88 + uPulse * 0.18 + 0.06 * sin(uTime * 1.7 + uSeed);
  float alpha = uOpacity * radial * along * breath;
  if (alpha < 0.0012) discard;

  vec3 warm = uColor * (0.85 + core * 0.55);
  vec3 hazeCol = mix(uColor, uColor * 0.75, veil * 0.35);
  vec3 col = mix(hazeCol, warm, core * 0.65) * uGain * (0.55 + bloom * 0.5);
  gl_FragColor = vec4(col, alpha * (0.42 + core * 0.35 + bloom * 0.25));
}
`;

const _mid = new THREE.Vector3();
const _along = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _side = new THREE.Vector3();
const _norm = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _aim = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

function placeBillboardBeam(
	mesh: THREE.Mesh,
	origin: THREE.Vector3,
	target: THREE.Vector3,
	camera: THREE.Camera,
	width: number,
): void {
	_along.subVectors(target, origin);
	const len = _along.length();
	if (len < 0.5) {
		mesh.visible = false;
		return;
	}
	mesh.visible = true;
	_along.multiplyScalar(1 / len);
	_mid.copy(origin).addScaledVector(_along, len * 0.5);

	camera.getWorldPosition(_toCam);
	_toCam.sub(_mid);
	_side.crossVectors(_along, _toCam);
	if (_side.lengthSq() < 1e-8) {
		_side.crossVectors(_along, _worldUp);
	}
	if (_side.lengthSq() < 1e-8) {
		_side.set(1, 0, 0);
	}
	_side.normalize();
	_norm.crossVectors(_side, _along).normalize();
	_side.crossVectors(_along, _norm).normalize();

	_mat.makeBasis(_side, _along, _norm);
	_quat.setFromRotationMatrix(_mat);
	mesh.position.copy(_mid);
	mesh.quaternion.copy(_quat);
	mesh.scale.set(width, len, 1);
}

type ShaftSlot = {
	mesh: THREE.Mesh;
	mat: THREE.ShaderMaterial;
	origin: THREE.Vector3;
	baseTarget: THREE.Vector3;
	seed: number;
	phase: number;
	speed: number;
	width: number;
};

function makeShaftMat(color: THREE.Color, seed: number): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: {
			uColor: { value: color.clone() },
			uOpacity: { value: 0.55 },
			uGain: { value: 1.85 },
			uTime: { value: 0 },
			uSeed: { value: seed },
			uPulse: { value: 0 },
		},
		vertexShader: SHAFT_VERT,
		fragmentShader: SHAFT_FRAG,
		transparent: true,
		depthWrite: false,
		depthTest: true,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
}

/**
 * Dynamiczne snopy floodlightów z pylonów — atmosfera prematch.
 */
export class StadiumJupiterShafts {
	readonly root = new THREE.Group();
	private readonly geo: THREE.PlaneGeometry;
	private readonly shafts: ShaftSlot[] = [];

	constructor() {
		this.root.name = "stadiumJupiterShafts";
		this.geo = new THREE.PlaneGeometry(1, 1, 1, 10);

		const cool = new THREE.Color(0.72, 0.86, 1.12);
		const warm = new THREE.Color(1.12, 0.88, 0.62);
		const soft = new THREE.Color(0.92, 0.94, 1.05);

		for (let i = 0; i < STADIUM_PYLON_SPECS.length; i++) {
			const spec = STADIUM_PYLON_SPECS[i]!;
			const origin = new THREE.Vector3(spec.x, spec.height + 0.6, spec.z);
			const baseTarget = new THREE.Vector3(
				spec.target[0],
				PLAYFIELD_SURFACE_Y + 0.4,
				spec.target[2],
			);
			const tint = i % 3 === 0 ? cool : i % 3 === 1 ? warm : soft;
			/** 2 snopy na pylon — lekko rozstrzelone. */
			for (let b = 0; b < 2; b++) {
				const seed = i * 7.3 + b * 2.9 + 0.4;
				const mat = makeShaftMat(tint, seed);
				const mesh = new THREE.Mesh(this.geo, mat);
				mesh.frustumCulled = false;
				mesh.renderOrder = 19;
				this.root.add(mesh);
				this.shafts.push({
					mesh,
					mat,
					origin: origin.clone(),
					baseTarget: baseTarget.clone(),
					seed,
					phase: seed * 0.7,
					speed: 0.22 + (i % 3) * 0.06 + b * 0.04,
					width: 9.5 + b * 3.2 + (i % 2) * 1.5,
				});
			}
		}

		/** Extra rozproszone snopy z dachu / boków. */
		const extras: Array<{ o: THREE.Vector3; t: THREE.Vector3; c: THREE.Color }> =
			[
				{
					o: new THREE.Vector3(-40, 42, 0),
					t: new THREE.Vector3(8, PLAYFIELD_SURFACE_Y + 0.5, 12),
					c: cool,
				},
				{
					o: new THREE.Vector3(40, 40, 0),
					t: new THREE.Vector3(-10, PLAYFIELD_SURFACE_Y + 0.5, -8),
					c: warm,
				},
				{
					o: new THREE.Vector3(0, 48, -70),
					t: new THREE.Vector3(0, PLAYFIELD_SURFACE_Y + 0.5, 20),
					c: soft,
				},
				{
					o: new THREE.Vector3(0, 48, 70),
					t: new THREE.Vector3(0, PLAYFIELD_SURFACE_Y + 0.5, -18),
					c: soft,
				},
			];
		for (let i = 0; i < extras.length; i++) {
			const e = extras[i]!;
			const seed = 40 + i * 5.1;
			const mat = makeShaftMat(e.c, seed);
			const mesh = new THREE.Mesh(this.geo, mat);
			mesh.frustumCulled = false;
			mesh.renderOrder = 19;
			this.root.add(mesh);
			this.shafts.push({
				mesh,
				mat,
				origin: e.o,
				baseTarget: e.t,
				seed,
				phase: seed,
				speed: 0.18 + i * 0.03,
				width: 14 + i * 1.2,
			});
		}
	}

	update(
		t: number,
		showU: number,
		pulse: number,
		camera: THREE.Camera,
		smokeDensity = 0,
	): void {
		camera.updateMatrixWorld(true);
		const fadeIn = THREE.MathUtils.smoothstep(showU, 0.02, 0.14);
		const fadeOut = 1 - THREE.MathUtils.smoothstep(showU, 0.84, 0.98);
		const presence = fadeIn * fadeOut;
		/** Party washes = współbohaterowie (nie gaszą pod laserami). */
		const laserPeak =
			THREE.MathUtils.smoothstep(showU, 0.22, 0.4) *
			(1 - THREE.MathUtils.smoothstep(showU, 0.7, 0.86));
		const jupiterYield = 1 - laserPeak * 0.15;
		const hazeBoost = 1 + smokeDensity * 0.22;

		for (let i = 0; i < this.shafts.length; i++) {
			const s = this.shafts[i]!;
			const g = t * s.speed + s.phase;
			const sweepX = Math.sin(g * 1.15) * 14 + Math.sin(g * 2.4) * 4;
			const sweepZ = Math.cos(g * 0.95 + 0.4) * 12 + Math.cos(g * 2.1) * 3.5;
			const nod = Math.sin(g * 1.6) * 2.2;
			_aim.set(
				s.baseTarget.x + sweepX,
				s.baseTarget.y + nod,
				s.baseTarget.z + sweepZ,
			);

			const width =
				s.width * (0.85 + pulse * 0.08 + Math.sin(g * 0.7) * 0.05);
			placeBillboardBeam(s.mesh, s.origin, _aim, camera, width);

			const breath = 0.35 + 0.25 * presence + pulse * 0.08;
			s.mat.uniforms.uOpacity!.value =
				breath * hazeBoost * 0.55 * jupiterYield;
			s.mat.uniforms.uGain!.value =
				(2.0 + pulse * 0.55 + presence * 0.45) * jupiterYield;
			s.mat.uniforms.uTime!.value = t;
			s.mat.uniforms.uPulse!.value = pulse;
			s.mesh.visible = presence > 0.04 && s.mesh.visible;
		}
	}

	dispose(): void {
		for (const s of this.shafts) {
			s.mat.dispose();
			s.mesh.removeFromParent();
		}
		this.shafts.length = 0;
		this.geo.dispose();
		this.root.removeFromParent();
	}
}
