/**
 * Aerial stadium lasers — camera-facing billboards.
 * Prematch lasers — choreografia PRZESTRZENNA (nie midfield knot):
 * team-half fans → parallel liquid-sky → goal curtains → grid columns.
 * Jedna rodzina hue na akt (addytywne RGB nie zlewają się w biel).
 * Dash = tekstura skanu, nie gaszenie rdzenia.
 */
import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";

const LASER_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Gruby volumetric beam: hot core + szeroki bloom + soft haze.
 * Poprzerywanie moduluje bloom (nie zabija rdzenia).
 */
const LASER_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uGain;
uniform float uTime;
uniform float uSeed;
uniform float uStrobeHz;
uniform float uStrobeAmt;
uniform float uDashScale;
uniform float uDashGap;
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

float strobeGate(float t, float hz, float seed) {
  float phase = fract(t * hz + seed);
  float mainFlash = step(phase, 0.28);
  float dbl = step(0.5, phase) * step(phase, 0.62);
  return max(mainFlash, dbl);
}

/** Dash = akcent skanu; floor ~0.55 żeby wiązka zawsze była widoczna. */
float beamDash(float y, float t, float seed, float scale, float gap) {
  float scroll = y * scale - t * (3.4 + hash(seed) * 2.2) + seed * 4.1;
  float cell = fract(scroll);
  float duty = clamp(1.0 - gap * 0.55, 0.55, 0.9);
  float seg = smoothstep(0.0, 0.05, cell) * smoothstep(duty, duty - 0.06, cell);
  float cellId = floor(scroll);
  float drop = step(0.12, hash(cellId * 19.17 + seed * 7.3));
  float micro = mix(0.75, 1.0, noise(vec2(y * 36.0 + seed, t * 2.8)));
  float live = max(seg * drop, 0.35) * micro;
  return mix(0.55, 1.15, live);
}

void main() {
  float edge = abs(vUv.x - 0.5) * 2.0;
  /** Szeroki kolorowy rdzeń — igła NIE może zdominować hue. */
  float needle = pow(1.0 - clamp(edge / 0.14, 0.0, 1.0), 2.8);
  float core = pow(1.0 - clamp(edge / 0.32, 0.0, 1.0), 2.2);
  float bloom = pow(1.0 - clamp(edge / 0.62, 0.0, 1.0), 1.8) * 0.55;
  float haze = pow(1.0 - clamp(edge / 0.92, 0.0, 1.0), 1.35) * 0.22;

  float n = noise(vec2(vUv.y * 18.0 + uTime * 2.2 + uSeed, edge * 4.0));
  float n2 = noise(vec2(vUv.y * 6.0 - uTime * 0.85 + uSeed * 3.1, edge * 2.0));
  float mottled = mix(0.9, 1.15, n) * mix(0.94, 1.08, n2);
  float flick = 0.95 + 0.05 * hash(floor(uTime * 36.0 + uSeed * 11.0));

  float along = smoothstep(0.0, 0.015, vUv.y) * smoothstep(1.02, 0.78, vUv.y);
  along *= 0.88 + 0.12 * sin(clamp(vUv.y, 0.0, 1.0) * 3.14159);

  float dash = beamDash(vUv.y, uTime, uSeed, max(uDashScale, 5.0), clamp(uDashGap, 0.1, 0.55));

  float chase = fract(vUv.y * 5.5 - uTime * (8.5 + uStrobeHz * 0.3) + uSeed * 1.7);
  float chaseBand = smoothstep(0.0, 0.07, chase) * smoothstep(0.45, 0.16, chase);
  float chaseMul = mix(0.9, 1.3, chaseBand);

  float gate = strobeGate(uTime, max(uStrobeHz, 0.01), uSeed * 0.37);
  float strobeMul = mix(1.0, mix(0.6, 1.2, gate), clamp(uStrobeAmt * 0.65, 0.0, 1.0));
  strobeMul *= mix(1.0, chaseMul, clamp(uStrobeAmt * 0.45, 0.0, 1.0));

  float radial =
    needle * 1.45 +
    core * 1.05 +
    bloom * dash * 0.7 +
    haze * mix(0.5, 0.9, dash) * 0.55;
  radial *= mottled * flick;
  float alpha = uOpacity * radial * along * strobeMul;
  if (alpha < 0.004) discard;

  /** Chromatic beam — lum z core/bloom; igła tylko lekko. ZERO white. */
  float lum = 0.4 + core * 0.85 + bloom * 0.55 + needle * 0.25;
  float flashBoost = mix(1.0, 1.0 + gate * 0.45, clamp(uStrobeAmt, 0.0, 1.0));
  vec3 col = uColor * lum * uGain * flashBoost;
  gl_FragColor = vec4(col, clamp(alpha * (0.7 + core * 0.4 + bloom * 0.2), 0.0, 1.0));
}
`;

const HAZE_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const HAZE_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
uniform float uPulse;
varying vec3 vWorld;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0 + i.z * 113.0;
  float a = hash(n);
  float b = hash(n + 1.0);
  float c = hash(n + 57.0);
  float d = hash(n + 58.0);
  float e = hash(n + 113.0);
  float g = hash(n + 114.0);
  float h = hash(n + 170.0);
  float j = hash(n + 171.0);
  float xy1 = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  float xy2 = mix(mix(e, g, f.x), mix(h, j, f.x), f.y);
  return mix(xy1, xy2, f.z);
}

void main() {
  float radial = 1.0 - smoothstep(10.0, 52.0, length(vWorld.xz));
  float height =
    smoothstep(0.35, 2.2, vWorld.y) *
    (1.0 - smoothstep(10.0, 18.5, vWorld.y));
  float n = noise3(vWorld * 0.065 + vec3(uTime * 0.1, uTime * 0.07, -uTime * 0.04));
  float n2 = noise3(vWorld * 0.16 + vec3(0.0, uTime * 0.18, 0.0));
  float dens =
    radial * height *
    mix(0.8, 1.3, n) *
    mix(0.9, 1.15, n2) *
    (0.88 + uPulse * 0.4);
  float alpha = uOpacity * dens;
  if (alpha < 0.0015) discard;
  /** Ciemny „Transmission haze” — nośnik pod beamy, nie mleczna ściana. */
  vec3 c0 = vec3(0.04, 0.12, 0.18);
  vec3 c1 = vec3(0.12, 0.04, 0.14);
  vec3 c2 = vec3(0.03, 0.1, 0.12);
  float w = fract(n * 2.7 + uPulse * 0.35);
  vec3 col = w < 0.33 ? c0 : w < 0.66 ? c1 : c2;
  gl_FragColor = vec4(col, alpha);
}
`;

const SHEET_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Liquid sky — pozioma warstwa scatteru (nie pełna ściana). */
const SHEET_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
uniform float uPulse;
varying vec2 vUv;
varying vec3 vWorld;

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
  float rx = abs(vUv.x - 0.5) * 2.0;
  float rz = abs(vUv.y - 0.5) * 2.0;
  float edge = max(rx, rz);
  float soft = 1.0 - smoothstep(0.55, 1.0, edge);
  float n = noise(vWorld.xz * 0.045 + vec2(uTime * 0.12, -uTime * 0.08));
  float n2 = noise(vWorld.xz * 0.11 - vec2(uTime * 0.05, uTime * 0.09));
  float swirl = noise(vWorld.xz * 0.07 + vec2(sin(uTime * 0.35), cos(uTime * 0.28)) * 2.5);
  float bands = abs(sin(vWorld.x * 0.08 + uTime * 1.4 + n * 2.0));
  bands *= abs(sin(vWorld.z * 0.07 - uTime * 1.1));
  /** Marble / liquid sky — swirle w haze, nie flat fill. */
  float marble = mix(0.55, 1.25, swirl) * mix(0.65, 1.2, bands);
  float dens = soft * mix(0.5, 1.2, n) * mix(0.75, 1.2, n2) * marble;
  dens *= 0.85 + uPulse * 0.4;
  float alpha = uOpacity * dens;
  if (alpha < 0.0035) discard;
  vec3 c0 = vec3(0.06, 0.2, 0.28);
  vec3 c1 = vec3(0.22, 0.05, 0.2);
  vec3 c2 = vec3(0.05, 0.18, 0.16);
  float w = fract(n * 3.1 + swirl * 0.5 + uPulse * 0.2);
  vec3 col = w < 0.33 ? c0 : w < 0.66 ? c1 : c2;
  gl_FragColor = vec4(col, alpha * 0.85);
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
const _tmp = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

/**
 * Widowisko — nasycona tęcza stadionowa (blue/orange team + rainbow accents).
 */
/** Team + accent — jedna rodzina hue na bank (nie tęcza→biel przy addytywności). */
export const LASER_PALETTE: readonly THREE.Color[] = [
	new THREE.Color(0.12, 0.55, 1.9), // blue
	new THREE.Color(1.9, 0.5, 0.06), // orange
	new THREE.Color(0.2, 0.85, 1.7), // cyan-blue
	new THREE.Color(1.7, 0.75, 0.1), // amber-orange
	new THREE.Color(1.55, 0.08, 1.4), // magenta (liquid)
	new THREE.Color(0.15, 1.55, 1.6), // aqua (liquid)
	new THREE.Color(1.7, 1.2, 0.1), // gold (drop)
	new THREE.Color(1.6, 0.2, 1.2), // pink-gold
];

const TEAM_BLUE = new THREE.Color(0.02, 0.45, 1.85);
const TEAM_ORANGE = new THREE.Color(1.9, 0.35, 0.02);
const ACT_MAGENTA = new THREE.Color(1.85, 0.02, 1.35);
const ACT_CYAN = new THREE.Color(0.02, 1.55, 1.65);
const ACT_GOLD = new THREE.Color(1.85, 1.15, 0.02);
const ACT_LIME = new THREE.Color(0.15, 1.75, 0.25);

/** Phase accent — tylko lekki klimat, kolor wymuszamy per akt poniżej. */
const PHASE_ACCENT = {
	intro: TEAM_BLUE,
	build: TEAM_ORANGE,
	liquid: ACT_MAGENTA,
	drop: ACT_GOLD,
	rain: ACT_LIME,
} as const;

function paletteColor(i: number, salt: number): THREE.Color {
	const idx =
		(Math.floor(i * 3 + salt * 7 + i * i) % LASER_PALETTE.length +
			LASER_PALETTE.length) %
		LASER_PALETTE.length;
	return LASER_PALETTE[idx]!;
}

function placeBillboardBeam(
	mesh: THREE.Mesh,
	origin: THREE.Vector3,
	target: THREE.Vector3,
	camera: THREE.Camera,
	width: number,
): void {
	_along.subVectors(target, origin);
	const len = _along.length();
	if (len < 0.08) {
		mesh.visible = false;
		return;
	}
	mesh.visible = true;
	_along.multiplyScalar(1 / len);
	_mid.copy(origin).addScaledVector(_along, len * 0.5);

	camera.getWorldPosition(_toCam);
	_toCam.sub(_mid);
	const dist = Math.max(4, _toCam.length());
	/** Lekki floor — bez grubych „placków” z bliska / look-up. */
	const screenMin = dist * 0.008;
	const w = Math.max(width, screenMin);

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
	mesh.scale.set(w, len, 1);
}

type BeamSlot = {
	mesh: THREE.Mesh;
	mat: THREE.ShaderMaterial;
	fanT: number;
	seed: number;
	color: THREE.Color;
	dashScale: number;
	dashGap: number;
};

type Projector = {
	origin: THREE.Vector3;
	beams: BeamSlot[];
	side: number;
	role: "roof" | "goal" | "side";
	galvoPhase: number;
	galvoSpeed: number;
};

function makeLaserMat(
	color: THREE.Color,
	seed: number,
	dashScale: number,
	dashGap: number,
): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: {
			uColor: { value: color.clone() },
			uOpacity: { value: 1 },
			uGain: { value: 4.2 },
			uTime: { value: 0 },
			uSeed: { value: seed },
			uStrobeHz: { value: 6 },
			uStrobeAmt: { value: 0.28 },
			uDashScale: { value: dashScale },
			uDashGap: { value: dashGap },
		},
		vertexShader: LASER_VERT,
		fragmentShader: LASER_FRAG,
		transparent: true,
		depthWrite: false,
		depthTest: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
}

export class StadiumLaserRig {
	readonly root = new THREE.Group();
	private readonly projectors: Projector[] = [];
	private readonly geo: THREE.PlaneGeometry;
	private readonly hazeMat: THREE.ShaderMaterial;
	private readonly haze: THREE.Mesh;
	private readonly sheetMat: THREE.ShaderMaterial;
	private readonly sheet: THREE.Mesh;
	private updateParity = 0;

	constructor() {
		this.root.name = "stadiumLaserRig";
		/** Więcej segmentów wzdłuż — smoother dash. */
		this.geo = new THREE.PlaneGeometry(1, 1, 1, 8);

		this.hazeMat = new THREE.ShaderMaterial({
			uniforms: {
				uOpacity: { value: 0 },
				uTime: { value: 0 },
				uPulse: { value: 0 },
			},
			vertexShader: HAZE_VERT,
			fragmentShader: HAZE_FRAG,
			transparent: true,
			depthWrite: false,
			depthTest: false,
			/** Normal — volume haze bez additive white-wash. */
			blending: THREE.NormalBlending,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		this.haze = new THREE.Mesh(
			new THREE.BoxGeometry(
				RL_ARENA.HALF_WIDTH * 2.15,
				18,
				RL_ARENA.HALF_LENGTH * 2.15,
			),
			this.hazeMat,
		);
		this.haze.position.y = PLAYFIELD_SURFACE_Y + 8.2;
		this.haze.renderOrder = 17;
		this.haze.frustumCulled = false;
		this.root.add(this.haze);

		this.sheetMat = new THREE.ShaderMaterial({
			uniforms: {
				uOpacity: { value: 0 },
				uTime: { value: 0 },
				uPulse: { value: 0 },
			},
			vertexShader: SHEET_VERT,
			fragmentShader: SHEET_FRAG,
			transparent: true,
			depthWrite: false,
			depthTest: false,
			blending: THREE.NormalBlending,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		this.sheet = new THREE.Mesh(
			new THREE.PlaneGeometry(
				RL_ARENA.HALF_WIDTH * 2.2,
				RL_ARENA.HALF_LENGTH * 2.2,
				1,
				1,
			),
			this.sheetMat,
		);
		this.sheet.rotation.x = -Math.PI * 0.5;
		this.sheet.position.y = PLAYFIELD_SURFACE_Y + 7.2;
		this.sheet.renderOrder = 18;
		this.sheet.frustumCulled = false;
		this.sheet.visible = false;
		this.root.add(this.sheet);

		this.buildProjectors();
	}

	private addProjector(
		origin: THREE.Vector3,
		beamCount: number,
		side: number,
		role: Projector["role"],
		galvoPhase: number,
		galvoSpeed: number,
		paletteOffset: number,
	): void {
		const beams: BeamSlot[] = [];
		for (let i = 0; i < beamCount; i++) {
			const seed = galvoPhase * 13.7 + i * 2.17 + side * 9.1;
			const color = paletteColor(i + paletteOffset, galvoPhase + side);
			const dashScale = 6 + (Math.abs(seed * 8) % 8);
			const dashGap = 0.14 + (Math.abs(seed * 2.4) % 1) * 0.18;
			const mat = makeLaserMat(color, seed, dashScale, dashGap);
			const mesh = new THREE.Mesh(this.geo, mat);
			mesh.frustumCulled = false;
			mesh.renderOrder = 28;
			this.root.add(mesh);
			beams.push({
				mesh,
				mat,
				fanT: beamCount <= 1 ? 0 : (i / (beamCount - 1)) * 2 - 1,
				seed,
				color,
				dashScale,
				dashGap,
			});
		}
		this.projectors.push({
			origin,
			beams,
			side,
			role,
			galvoPhase,
			galvoSpeed,
		});
	}

	private buildProjectors(): void {
		const hw = RL_ARENA.HALF_WIDTH;
		const hl = RL_ARENA.HALF_LENGTH;
		const roofY = RL_ARENA.HEIGHT - 0.6;

		/**
		 * Choreografia przestrzenna (NIE midfield knot):
		 * 8 banków × 3 wiązki = 24 snopy — czytelne grupy kolorów.
		 * Blue goal (−Z) / Orange goal (+Z) / boki pod liquid-sky.
		 */
		// Blue half roof + goal
		this.addProjector(new THREE.Vector3(-hw * 0.55, roofY, -hl * 0.55), 3, 0, "roof", 0.2, 0.7, 0);
		this.addProjector(new THREE.Vector3(hw * 0.55, roofY, -hl * 0.55), 3, 0, "roof", 0.9, 0.75, 0);
		this.addProjector(new THREE.Vector3(0, roofY * 0.9, -hl * 0.98), 3, 0, "goal", 0.4, 0.85, 0);

		// Orange half roof + goal
		this.addProjector(new THREE.Vector3(-hw * 0.55, roofY, hl * 0.55), 3, 1, "roof", 1.3, 0.7, 1);
		this.addProjector(new THREE.Vector3(hw * 0.55, roofY, hl * 0.55), 3, 1, "roof", 2.0, 0.75, 1);
		this.addProjector(new THREE.Vector3(0, roofY * 0.9, hl * 0.98), 3, 1, "goal", 1.7, 0.85, 1);

		// Sideline scanners — liquid sky / parallel sweeps
		this.addProjector(new THREE.Vector3(-hw * 0.98, 15, 0), 3, 0, "side", 0.6, 0.65, 5);
		this.addProjector(new THREE.Vector3(hw * 0.98, 15, 0), 3, 1, "side", 2.4, 0.65, 5);
	}

	update(
		t: number,
		showU: number,
		pulse: number,
		camera: THREE.Camera,
		smokeDensity = 0,
		qualityScale = 1,
	): void {
		const hw = RL_ARENA.HALF_WIDTH;
		const hl = RL_ARENA.HALF_LENGTH;
		const floor = PLAYFIELD_SURFACE_Y + 0.15;
		camera.updateMatrixWorld(true);

		/**
		 * NOWA choreografia (Pangolin sports / liquid sky):
		 * shafts = kolumny przy brzegach
		 * fans = team split (blue/orange połówki, BEZ zbiegu na środek)
		 * liquid = równoległe aerial sweeps wzdłuż boiska
		 * tunnel = kurtyny z bramek na boki (otwarcie, nie midfield knot)
		 * hotSweep = celebracyjne kolumny w siatce pozycji
		 */
		const mode =
			showU < 0.12
				? "shafts"
				: showU < 0.32
					? "fans"
					: showU < 0.5
						? "liquid"
						: showU < 0.7
							? "tunnel"
							: "hotSweep";

		/** Trance kick — twarde pierdolnięcie szerokości/gain na downbeat. */
		const kick = pulse * pulse;
		const beat = 1 + kick * 0.85;
		void PHASE_ACCENT;

		/** Haze tylko jako medium — nisko, żeby nie myć kolorów. */
		const hazeTarget =
			showU < 0.1
				? 0.05
				: showU < 0.7
					? 0.09 + pulse * 0.03
					: 0.05 * (1 - THREE.MathUtils.smoothstep(showU, 0.88, 1));
		this.haze.visible = hazeTarget > 0.01;
		this.hazeMat.uniforms.uOpacity!.value = hazeTarget * qualityScale;
		this.hazeMat.uniforms.uTime!.value = t;
		this.hazeMat.uniforms.uPulse!.value = pulse;

		/** Sheet tylko w liquid — równoległe niebo, nie white fill. */
		const sheetOn = mode === "liquid";
		this.sheet.visible = sheetOn && qualityScale > 0.35;
		this.sheetMat.uniforms.uOpacity!.value = sheetOn
			? (0.12 + pulse * 0.05) * qualityScale
			: 0;
		this.sheetMat.uniforms.uTime!.value = t;
		this.sheetMat.uniforms.uPulse!.value = pulse;

		let strobeHz = 2.4;
		let strobeAmt = 0.08;
		if (mode === "fans") {
			strobeHz = 3.2;
			strobeAmt = 0.12;
		} else if (mode === "liquid") {
			strobeHz = 3.8;
			strobeAmt = 0.1;
		} else if (mode === "tunnel") {
			strobeHz = 8.5;
			strobeAmt = 0.42;
		} else if (mode === "hotSweep") {
			strobeHz = 4.2;
			strobeAmt = 0.16;
		}
		strobeHz *= 1 + pulse * 0.25;
		strobeAmt = Math.min(0.35, strobeAmt + pulse * 0.08);

		const gapBoost = Math.max(0, 0.03 - smokeDensity * 0.03);
		const pulseWidth = 1.2 + kick * 0.75;
		const pulseGain = 1 + kick * 0.55;

		this.updateParity++;
		const heavyFrame = (this.updateParity & 1) === 0;
		for (const proj of this.projectors) {
			/** Side scanners co 2. klatkę poza DROP — mniej placeBillboard. */
			if (
				proj.role === "side" &&
				mode !== "tunnel" &&
				mode !== "liquid" &&
				!heavyFrame
			) {
				continue;
			}
			const o = proj.origin;
			const g = t * proj.galvoSpeed * (1 + pulse * 0.25) + proj.galvoPhase;
			const sweep = Math.sin(g * 1.6) * 0.7 + Math.sin(g * 3.1) * 0.2;
			const sweep2 = Math.cos(g * 1.2 + 0.4) * 0.55;

			/** Team half: side 0 / −Z = blue, side 1 / +Z = orange. */
			const isBlueBank = proj.side < 0.5 || o.z < -1;

			for (const slot of proj.beams) {
				const ft = slot.fanT;
				let width = 4.2;
				let gain = 2.8 * beat;
				let opacity = 0.88;

				slot.mat.uniforms.uTime!.value = t;
				slot.mat.uniforms.uStrobeHz!.value =
					strobeHz * (0.92 + Math.abs(slot.seed % 1) * 0.15);
				slot.mat.uniforms.uStrobeAmt!.value = strobeAmt;
				slot.mat.uniforms.uDashScale!.value = slot.dashScale;
				slot.mat.uniforms.uDashGap!.value = Math.min(
					0.38,
					slot.dashGap + gapBoost,
				);

				slot.mesh.visible = true;

				if (mode === "shafts") {
					/**
					 * Kolumny przy własnym banku — prawie pionowo w dół,
					 * lekki offset na zewnątrz (NIE do środka).
					 */
					if (proj.role === "side") {
						slot.mesh.visible = false;
						continue;
					}
					const outX = Math.sign(o.x || ft || 0.01) * (6 + Math.abs(ft) * 8);
					const outZ = Math.sign(o.z || 0.01) * (4 + Math.abs(ft) * 5);
					_aim.set(
						o.x * 0.55 + outX * 0.35 + ft * 3,
						floor + 0.15,
						o.z * 0.55 + outZ * 0.35,
					);
					width = 4.8;
					gain = 4.0 * beat;
					opacity = 0.8;
					slot.mat.uniforms.uColor!.value.copy(
						isBlueBank ? TEAM_BLUE : TEAM_ORANGE,
					);
				} else if (mode === "fans") {
					/**
					 * TEAM SPLIT — każdy bank oświetla TYLKO swoją połówkę.
					 * Fany równoległe do linii bocznej, aim zostaje na |z| > hl*0.15.
					 */
					if (proj.role === "side") {
						slot.mesh.visible = false;
						continue;
					}
					const halfSign = isBlueBank ? -1 : 1;
					const alongX = ft * hw * 0.85 + sweep * 4;
					const depth =
						halfSign * (hl * (0.35 + Math.abs(ft) * 0.25) + 8 + sweep2 * 3);
					_aim.set(
						THREE.MathUtils.clamp(alongX, -hw * 0.95, hw * 0.95),
						floor + 0.2 + Math.abs(ft) * 0.4,
						THREE.MathUtils.clamp(depth, -hl * 0.95, hl * 0.95),
					);
					/** Twarda bariera: nie wjeżdżaj na przeciwną połówkę / środek. */
					if (isBlueBank) {
						_aim.z = Math.min(_aim.z, -hl * 0.18);
					} else {
						_aim.z = Math.max(_aim.z, hl * 0.18);
					}
					width = 5.6 + kick * 0.8;
					gain = 4.3 * beat;
					opacity = 0.9;
					slot.mat.uniforms.uColor!.value.copy(
						isBlueBank ? TEAM_BLUE : TEAM_ORANGE,
					);
				} else if (mode === "liquid") {
					/**
					 * LIQUID SKY — równoległe sweeps WZDŁUŻ boiska (oś Z).
					 * Boki strzelają przez długość; dach pomaga jako wysokie pasma.
					 * Beams prawie równoległe → nie zbiegają się w jednym punkcie.
					 */
					const zTravel = ft * hl * 0.9 + sweep * hl * 0.15;
					if (proj.role === "side") {
						const toward = -Math.sign(o.x || 1);
						_aim.set(
							toward * hw * 0.15 + sweep2 * 3,
							8.5 + Math.sin(g + ft) * 1.2 + pulse * 0.5,
							zTravel,
						);
						slot.mat.uniforms.uColor!.value
							.copy(ft < 0 ? ACT_CYAN : ACT_MAGENTA)
							.lerp(ft < 0 ? ACT_MAGENTA : ACT_CYAN, 0.35 + pulse * 0.2);
					} else {
						/** Dach: wysokie pasma wzdłuż Z, X rozłożone — nie do (0,y,0). */
						_aim.set(
							(isBlueBank ? -1 : 1) * (hw * 0.35 + ft * hw * 0.4),
							7.5 + Math.abs(ft) * 2,
							zTravel * 0.85,
						);
						slot.mat.uniforms.uColor!.value.copy(
							isBlueBank ? ACT_CYAN : ACT_MAGENTA,
						);
					}
					width = 6.0 + kick * 1.0;
					gain = 4.0 * beat;
					opacity = 0.85;
				} else if (mode === "tunnel") {
					/**
					 * DROP = kurtyny z BRAMEK na BOKI (otwarcie jak UCL).
					 * Aim idzie na sideline, NIE na midfield ring.
					 */
					if (proj.role === "side") {
						slot.mesh.visible = false;
						continue;
					}
					const open =
						THREE.MathUtils.smoothstep(showU, 0.5, 0.7) * (1.1 + pulse * 0.15);
					const halfSign = isBlueBank ? -1 : 1;
					const sideX = (ft < 0 ? -1 : 1) * hw * (0.55 + open * 0.4);
					_aim.set(
						sideX + sweep * 2,
						3.5 + Math.abs(ft) * 2.5 + open * 2,
						halfSign * hl * (0.55 - open * 0.25),
					);
					width = 6.2 + kick * 1.8;
					gain = (5.8 + open * 1.4 + kick * 1.85) * beat;
					opacity = 0.92;
					slot.mat.uniforms.uColor!.value
						.copy(ACT_GOLD)
						.lerp(isBlueBank ? TEAM_BLUE : TEAM_ORANGE, 0.25);
				} else {
					/**
					 * Celebration — pionowe kolumny w SIATCE wokół boiska.
					 * Każdy slot ma stały „slot” pozycji, daleko od środka.
					 */
					const fade =
						1 - THREE.MathUtils.smoothstep(showU, 0.88, 1) * 0.85;
					const gridX = (ft + sweep * 0.15) * hw * 0.75;
					const gridZ =
						(isBlueBank ? -1 : 1) * (hl * 0.45 + Math.abs(ft) * hl * 0.25);
					if (proj.role === "side") {
						_aim.set(
							Math.sign(o.x || 1) * hw * 0.7,
							floor + 0.2,
							ft * hl * 0.7,
						);
						slot.mat.uniforms.uColor!.value.copy(ACT_LIME);
					} else {
						_aim.set(gridX, floor + 0.15, gridZ);
						slot.mat.uniforms.uColor!.value.copy(
							isBlueBank ? TEAM_BLUE : TEAM_ORANGE,
						);
					}
					width = 4.6;
					gain = 5.0 * beat * fade;
					opacity = 0.88 * fade;
				}

				_tmp.copy(_aim);
				_tmp.y = Math.max(floor, _tmp.y);
				_tmp.x = THREE.MathUtils.clamp(_tmp.x, -hw * 1.05, hw * 1.05);
				_tmp.z = THREE.MathUtils.clamp(_tmp.z, -hl * 1.05, hl * 1.05);

				/** Zero phase-lerp do bieli — kolor już ustawiony per akt. */
				slot.mat.uniforms.uGain!.value =
					gain * pulseGain * (0.95 + smokeDensity * 0.08);
				slot.mat.uniforms.uOpacity!.value =
					opacity * (0.9 + smokeDensity * 0.08);

				placeBillboardBeam(slot.mesh, o, _tmp, camera, width * pulseWidth);
			}
		}
	}

	dispose(): void {
		this.root.removeFromParent();
		for (const proj of this.projectors) {
			for (const slot of proj.beams) {
				slot.mat.dispose();
			}
		}
		this.haze.geometry.dispose();
		this.hazeMat.dispose();
		this.sheet.geometry.dispose();
		this.sheetMat.dispose();
		this.geo.dispose();
	}
}
