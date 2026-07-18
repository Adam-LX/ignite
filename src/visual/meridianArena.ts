import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import type Scene from "../Scene";
import {
	clearArenaPhysics,
	restoreStandardPhysicsCage,
	setSkyDronesEnabled,
} from "./arena";
import { RL_ARENA } from "./arenaConstants";
import { makeArenaTrimeshCollider } from "./arenaPhysics";
import { createPhysicsBodyRegistry } from "./physicsBodyRegistry";

const BLUE = 0x1ec8ee;
const ORANGE = 0xff5522;
const GRID_WHITE = 0xe8f4ff;

/** Wewnętrzny promień — trochę większy niż diagonal boiska RL. */
export function meridianSphereRadius(): number {
	const { HALF_WIDTH, HALF_LENGTH } = RL_ARENA;
	return Math.hypot(HALF_WIDTH, HALF_LENGTH) + 10;
}

const meridianPhysics = createPhysicsBodyRegistry();

export type MeridianSphereSpec = {
	center: THREE.Vector3;
	radius: number;
};

export type MeridianArenaHandle = MeridianSphereSpec & {
	root: THREE.Group;
	ballGuide: THREE.Group;
};

let active: MeridianArenaHandle | null = null;
let stadiumWasVisible = true;
const _ballGuideDir = new THREE.Vector3();
const _ballGuideQuat = new THREE.Quaternion();
const _ballGuideZ = new THREE.Vector3(0, 0, 1);

const SHELL_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vLocalPos;
varying vec3 vWorldPos;

void main() {
	vUv = uv;
	vLocalPos = position;
	vec4 world = modelMatrix * vec4(position, 1.0);
	vWorldPos = world.xyz;
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * Skorupa: ciemny fill (czytelność / occlusion) + ostry grid drużynowy.
 * BackSide — patrzymy od środka.
 */
const SHELL_FRAGMENT = /* glsl */ `
uniform vec3 uTint;
uniform vec3 uGridColor;
uniform float uFillOpacity;
uniform float uGridOpacity;
uniform float uLonLines;
uniform float uLatLines;
uniform float uBumpScale;
uniform float uBumpStrength;
uniform float uTime;

varying vec2 vUv;
varying vec3 vLocalPos;
varying vec3 vWorldPos;

float lineMask(float coord, float width) {
	float f = abs(fract(coord) - 0.5);
	float aa = fwidth(coord) * 1.2;
	return 1.0 - smoothstep(0.0, max(aa, width), f);
}

float hash31(vec3 p) {
	p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float valueNoise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	vec3 u = f * f * (3.0 - 2.0 * f);
	float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
	float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
	float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
	float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
	float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
	float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
	float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
	float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
	float nx00 = mix(n000, n100, u.x);
	float nx10 = mix(n010, n110, u.x);
	float nx01 = mix(n001, n101, u.x);
	float nx11 = mix(n011, n111, u.x);
	float nxy0 = mix(nx00, nx10, u.y);
	float nxy1 = mix(nx01, nx11, u.y);
	return mix(nxy0, nxy1, u.z);
}

float fbm(vec3 p) {
	float a = 0.5;
	float s = 0.0;
	for (int i = 0; i < 3; i++) {
		s += a * valueNoise(p);
		p = p * 2.07 + vec3(17.1, 9.3, 5.7);
		a *= 0.5;
	}
	return s;
}

float bumpHeight(vec3 dir) {
	float slow = fbm(dir * uBumpScale + vec3(0.0, uTime * 0.012, 0.0));
	float fine = fbm(dir * (uBumpScale * 2.8) + 19.0);
	return slow * 0.75 + fine * 0.25;
}

void main() {
	vec3 dir = normalize(vLocalPos);
	vec3 geoN = -dir;

	float h = bumpHeight(dir);
	float eps = 0.014;
	vec3 t1 = normalize(cross(geoN, abs(dir.y) < 0.92 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
	vec3 t2 = normalize(cross(geoN, t1));
	float hx = bumpHeight(normalize(dir + t1 * eps));
	float hy = bumpHeight(normalize(dir + t2 * eps));
	vec3 bumpN = normalize(
		geoN + (h - hx) * (uBumpStrength / eps) * t1 + (h - hy) * (uBumpStrength / eps) * t2
	);

	float lon = vUv.x * uLonLines;
	float lat = vUv.y * uLatLines;
	float grid = max(lineMask(lon, 0.04), lineMask(lat, 0.04));
	float majorLon = lineMask(vUv.x * (uLonLines * 0.25), 0.085);
	float majorLat = lineMask(vUv.y * (uLatLines * 0.25), 0.085);
	float major = max(majorLon, majorLat);
	float poles = smoothstep(0.05, 0.0, min(vUv.y, 1.0 - vUv.y));
	float lineW = clamp(grid * 0.7 + major * 1.15, 0.0, 1.0);

	// Ciemny fill drużyny — wysoki kontrast z liniami (czytelność lokalizacji).
	vec3 fillCol = uTint * (0.22 + h * 0.12);
	vec3 lineCol = mix(uGridColor, vec3(1.0), 0.35);
	vec3 col = mix(fillCol, lineCol, lineW);

	float equatorGlow = 1.0 - smoothstep(0.0, 0.08, abs(dir.y));
	col = mix(col, lineCol, equatorGlow * 0.45);

	vec3 V = normalize(cameraPosition - vWorldPos);
	vec3 L1 = normalize(vec3(0.25, 0.9, 0.2));
	float ndl = 0.35 + 0.65 * max(0.0, dot(bumpN, L1));
	float fresnel = pow(1.0 - max(0.0, dot(bumpN, V)), 2.2);
	col *= ndl;
	col += lineCol * fresnel * 0.22;
	col += fillCol * equatorGlow * 0.15;

	float alpha =
		uFillOpacity +
		lineW * uGridOpacity +
		poles * 0.15 +
		equatorGlow * 0.2 +
		fresnel * 0.06;
	gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.98));
}
`;

function createShellMaterial(tint: number): THREE.ShaderMaterial {
	const base = new THREE.Color(tint);
	const grid = base.clone().lerp(new THREE.Color(0xffffff), 0.55);
	return new THREE.ShaderMaterial({
		uniforms: {
			uTint: { value: base.clone().multiplyScalar(0.9) },
			uGridColor: { value: grid },
			uFillOpacity: { value: 0.78 },
			uGridOpacity: { value: 0.72 },
			uLonLines: { value: 36 },
			uLatLines: { value: 18 },
			uBumpScale: { value: 5.5 },
			uBumpStrength: { value: 0.06 },
			uTime: { value: 0 },
		},
		vertexShader: SHELL_VERTEX,
		fragmentShader: SHELL_FRAGMENT,
		transparent: true,
		depthWrite: true,
		side: THREE.BackSide,
		blending: THREE.NormalBlending,
	});
}

/** Nieprzezroczysta „ściana” pod gridem — auto nie znika w skorupie. */
function createOcclusionShell(radius: number): THREE.Mesh {
	const geo = new THREE.SphereGeometry(radius * 1.004, 64, 40);
	const mat = new THREE.MeshBasicMaterial({
		color: 0x050810,
		side: THREE.BackSide,
		transparent: true,
		opacity: 0.82,
		depthWrite: true,
	});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = "meridianOcclusion";
	mesh.renderOrder = 0;
	mesh.frustumCulled = false;
	return mesh;
}

function buildBallGuide(): THREE.Group {
	const g = new THREE.Group();
	g.name = "meridianBallGuide";

	const ring = new THREE.Mesh(
		new THREE.RingGeometry(1.1, 1.55, 32),
		new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.92,
			side: THREE.DoubleSide,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		}),
	);
	ring.name = "meridianBallRing";

	const disc = new THREE.Mesh(
		new THREE.CircleGeometry(0.55, 24),
		new THREE.MeshBasicMaterial({
			color: 0xffee88,
			transparent: true,
			opacity: 0.55,
			side: THREE.DoubleSide,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		}),
	);
	disc.name = "meridianBallDisc";

	g.add(ring, disc);
	g.renderOrder = 5;
	g.visible = false;
	return g;
}

function buildHemisphereMesh(
	radius: number,
	phiStart: number,
	phiLength: number,
	color: number,
): THREE.Mesh {
	const geo = new THREE.SphereGeometry(
		radius,
		96,
		56,
		phiStart,
		phiLength,
		0,
		Math.PI,
	);
	const mesh = new THREE.Mesh(geo, createShellMaterial(color));
	mesh.frustumCulled = false;
	mesh.renderOrder = 2;
	return mesh;
}

function buildTubeRing(
	radius: number,
	tube: number,
	color: number,
	opacity: number,
	plane: "xz" | "xy" = "xz",
	arc = Math.PI * 2,
): THREE.Mesh {
	const geo = new THREE.TorusGeometry(
		radius,
		tube,
		8,
		Math.max(24, Math.ceil(64 * (arc / (Math.PI * 2)))),
		arc,
	);
	const mat = new THREE.MeshBasicMaterial({
		color,
		transparent: true,
		opacity,
		depthTest: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
	});
	const mesh = new THREE.Mesh(geo, mat);
	if (plane === "xz") {
		mesh.rotation.x = Math.PI / 2;
	}
	mesh.frustumCulled = false;
	/** Za skorupą (patrząc z wnętrza) — nie zasłania aut. */
	mesh.renderOrder = 0;
	return mesh;
}

/**
 * Rig na zewnątrz skorupy: centerline = R + tube*0.35,
 * żeby tuby nie wchodziły do wnętrza i nie occludowały aut.
 */
function buildOrientationRig(sphereRadius: number): THREE.Group {
	const rig = new THREE.Group();
	rig.name = "meridianOrientationRig";

	const place = (tube: number) => sphereRadius + tube * 0.35;

	const eqTube = 0.45;
	const eqR = place(eqTube);
	const eqOrange = buildTubeRing(eqR, eqTube, ORANGE, 0.95, "xz", Math.PI);
	eqOrange.name = "meridianEquatorOrange";
	const eqBlue = buildTubeRing(eqR, eqTube, BLUE, 0.95, "xz", Math.PI);
	eqBlue.rotation.y = Math.PI;
	eqBlue.name = "meridianEquatorBlue";
	rig.add(eqOrange, eqBlue);

	for (const elevDeg of [30, 60, -30, -60]) {
		const elev = (elevDeg * Math.PI) / 180;
		const latTube = 0.18;
		const shellR = place(latTube);
		const y = Math.sin(elev) * shellR;
		const ringR = Math.cos(elev) * shellR;
		const o = buildTubeRing(ringR, latTube, ORANGE, 0.5, "xz", Math.PI);
		o.position.y = y;
		o.name = `meridianLat${elevDeg}Orange`;
		const b = buildTubeRing(ringR, latTube, BLUE, 0.5, "xz", Math.PI);
		b.rotation.y = Math.PI;
		b.position.y = y;
		b.name = `meridianLat${elevDeg}Blue`;
		rig.add(o, b);
	}

	for (let i = 0; i < 8; i++) {
		const yaw = (i / 8) * Math.PI * 2;
		const isCardinal = i % 2 === 0;
		const lonTube = isCardinal ? 0.22 : 0.14;
		const mer = buildTubeRing(
			place(lonTube),
			lonTube,
			GRID_WHITE,
			isCardinal ? 0.38 : 0.22,
			"xy",
		);
		mer.rotation.y = yaw;
		mer.name = `meridianLon${i}`;
		rig.add(mer);
	}

	const splitTube = 0.32;
	const split = buildTubeRing(place(splitTube), splitTube, 0xffffff, 0.85, "xy");
	split.name = "meridianSplitPlane";
	rig.add(split);

	return rig;
}

/**
 * Dyski „podłogi” przy dnie sfery — lokalna siatka + wyraźne połowy blue/orange.
 * (W sferze dół = lokalne y = −R.)
 */
function buildFloorPad(radius: number): THREE.Mesh {
	const size = radius * 1.35;
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 512;
	const ctx = canvas.getContext("2d")!;
	ctx.clearRect(0, 0, 512, 512);

	const cx = 256;
	const cy = 256;

	// PlaneGeometry + rot.x=-90: +v (góra tekstury) → −Z (blue), dół tekstury → +Z (orange).
	ctx.beginPath();
	ctx.arc(cx, cy, 248, 0, Math.PI * 2);
	ctx.closePath();
	ctx.save();
	ctx.clip();

	ctx.fillStyle = "rgba(255, 85, 34, 0.42)";
	ctx.fillRect(0, cy, 512, 256); // +Z orange
	ctx.fillStyle = "rgba(30, 200, 238, 0.42)";
	ctx.fillRect(0, 0, 512, 256); // −Z blue

	const grad = ctx.createRadialGradient(cx, cy, 30, cx, cy, 250);
	grad.addColorStop(0, "rgba(20, 30, 50, 0.15)");
	grad.addColorStop(1, "rgba(0, 0, 0, 0.55)");
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, 512, 512);
	ctx.restore();

	ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
	ctx.lineWidth = 3;
	for (let i = 1; i <= 6; i++) {
		ctx.beginPath();
		ctx.arc(cx, cy, i * 36, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
	ctx.lineWidth = 2;
	for (let a = 0; a < 12; a++) {
		const ang = (a / 12) * Math.PI * 2;
		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.lineTo(cx + Math.cos(ang) * 250, cy + Math.sin(ang) * 250);
		ctx.stroke();
	}

	// Linia podziału połówek (Z=0 → oś X na padzie).
	ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
	ctx.lineWidth = 6;
	ctx.beginPath();
	ctx.moveTo(0, cy);
	ctx.lineTo(512, cy);
	ctx.stroke();

	ctx.fillStyle = "rgba(255, 120, 60, 0.95)";
	ctx.font = "bold 36px sans-serif";
	ctx.textAlign = "center";
	ctx.fillText("ORANGE", cx, cy + 160);
	ctx.fillStyle = "rgba(80, 220, 255, 0.95)";
	ctx.fillText("BLUE", cx, cy - 130);

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.needsUpdate = true;

	const mat = new THREE.MeshBasicMaterial({
		map: tex,
		transparent: true,
		opacity: 1,
		depthWrite: false,
		side: THREE.DoubleSide,
		blending: THREE.NormalBlending,
	});
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
	mesh.rotation.x = -Math.PI / 2;
	mesh.position.y = -radius + 0.12;
	mesh.name = "meridianFloorPad";
	mesh.frustumCulled = false;
	mesh.renderOrder = 2;
	return mesh;
}

/** Inward-facing sphere trimesh (wysoka rozdzielczość — mniej tunelowania). */
function buildInwardSphereTrimesh(
	radius: number,
): { positions: Float32Array; indices: Uint32Array } {
	const geo = new THREE.SphereGeometry(radius, 96, 56);
	const posAttr = geo.getAttribute("position");
	const positions = new Float32Array(posAttr.array.length);
	positions.set(posAttr.array as ArrayLike<number>);

	const src = geo.index;
	if (!src) {
		geo.dispose();
		throw new Error("SphereGeometry missing index");
	}
	const indices = new Uint32Array(src.count);
	for (let i = 0; i < src.count; i += 3) {
		indices[i] = src.getX(i);
		indices[i + 1] = src.getX(i + 2);
		indices[i + 2] = src.getX(i + 1);
	}
	geo.dispose();
	return { positions, indices };
}

function disposeObjectTree(root: THREE.Object3D): void {
	root.traverse((node) => {
		if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
			node.geometry.dispose();
			const mats = Array.isArray(node.material)
				? node.material
				: [node.material];
			for (const m of mats) {
				if (
					m instanceof THREE.MeshBasicMaterial ||
					m instanceof THREE.MeshStandardMaterial
				) {
					m.map?.dispose();
				}
				m.dispose();
			}
		}
	});
}

/**
 * Meridian — wyłącznie zamknięta sfera (bez floor/band RL).
 * Środek (0, R, 0) → dno wnętrza na y≈0; wall-ride po normals jak na ścianie RL.
 */
export function setupMeridianArena(scene: Scene): MeridianArenaHandle {
	teardownMeridianArena(scene, false);

	const stadium = scene.threeJSScene.getObjectByName("full_rl_stadium");
	const world = scene.rapierWorld;
	const radius = meridianSphereRadius();
	const center = new THREE.Vector3(0, radius, 0);

	if (stadium) {
		stadiumWasVisible = stadium.visible;
		stadium.visible = false;
	}

	/** Drony nad stadionem RL — zbędne / poświata wewnątrz Meridian. */
	setSkyDronesEnabled(false);

	clearArenaPhysics(world);

	const { positions, indices } = buildInwardSphereTrimesh(radius);
	const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	body.setTranslation({ x: center.x, y: center.y, z: center.z }, true);
	meridianPhysics.track(world, body);
	world.createCollider(
		makeArenaTrimeshCollider(positions, indices, "meridian"),
		body,
	);

	const root = new THREE.Group();
	root.name = "meridianSphere";
	root.position.copy(center);

	const ballGuide = buildBallGuide();

	/** +Z = orange half, −Z = blue half (jak scoring). */
	const orangeHemi = buildHemisphereMesh(radius, 0, Math.PI, ORANGE);
	orangeHemi.name = "meridianHemiOrange";
	const blueHemi = buildHemisphereMesh(radius, Math.PI, Math.PI, BLUE);
	blueHemi.name = "meridianHemiBlue";
	root.add(
		createOcclusionShell(radius),
		orangeHemi,
		blueHemi,
		buildOrientationRig(radius),
		buildFloorPad(radius),
		ballGuide,
	);

	scene.threeJSScene.add(root);
	active = { root, ballGuide, radius, center: center.clone() };
	return active;
}

export function teardownMeridianArena(
	scene: Scene,
	restoreCage = true,
): void {
	const stadium = scene.threeJSScene.getObjectByName("full_rl_stadium");

	if (active) {
		active.root.removeFromParent();
		disposeObjectTree(active.root);
		active = null;
	}

	meridianPhysics.clear(scene.rapierWorld);

	if (stadium) {
		stadium.visible = stadiumWasVisible;
	}

	setSkyDronesEnabled(true);

	if (restoreCage && stadium instanceof THREE.Group) {
		restoreStandardPhysicsCage(scene.rapierWorld, stadium);
	}
}

/** Wolny dryf bumpu + marker piłki na skorupie. */
export function updateMeridianArenaVisuals(
	timeSec: number,
	ballPos?: THREE.Vector3,
): void {
	if (!active) return;
	active.root.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) return;
		const mat = node.material;
		if (mat instanceof THREE.ShaderMaterial && mat.uniforms.uTime) {
			mat.uniforms.uTime.value = timeSec;
		}
	});
	if (ballPos) updateMeridianBallGuide(ballPos);
}

/** Pierścień na skorupie w kierunku piłki — lokalizacja gdy piłka wysoko / za autem. */
export function updateMeridianBallGuide(ballWorld: THREE.Vector3): void {
	if (!active) return;
	const guide = active.ballGuide;
	_ballGuideDir.copy(ballWorld).sub(active.center);
	const dist = _ballGuideDir.length();
	if (dist < 0.2) {
		guide.visible = false;
		return;
	}
	_ballGuideDir.multiplyScalar(1 / dist);
	/** Marker tuż pod skorupą (local space root = center). */
	guide.position.copy(_ballGuideDir).multiplyScalar(active.radius * 0.992);
	_ballGuideQuat.setFromUnitVectors(_ballGuideZ, _ballGuideDir);
	guide.quaternion.copy(_ballGuideQuat);
	const proximity = THREE.MathUtils.clamp(
		1 - Math.abs(dist - active.radius) / 18,
		0.35,
		1,
	);
	guide.scale.setScalar(1.1 + proximity * 0.85);
	guide.visible = true;
}

export function getMeridianSphere(): MeridianSphereSpec | null {
	if (!active) return null;
	return { center: active.center.clone(), radius: active.radius };
}

export function isMeridianArenaActive(): boolean {
	return active !== null;
}

const _normalScratch = new THREE.Vector3();

/**
 * Normal „podłogi” we wnętrzu sfery (wskazuje do środka = w górę względem powierzchni).
 * Stabilniejszy niż noisy normals z trimesha.
 */
export function meridianSurfaceNormalAt(
	worldPos: THREE.Vector3 | { x: number; y: number; z: number },
	out: THREE.Vector3,
): boolean {
	if (!active) return false;
	out.set(
		active.center.x - worldPos.x,
		active.center.y - worldPos.y,
		active.center.z - worldPos.z,
	);
	if (out.lengthSq() < 1e-10) {
		out.set(0, 1, 0);
		return true;
	}
	out.normalize();
	return true;
}

const _containScratch = new THREE.Vector3();

/**
 * Awaryjny clamp — gdy ciało przebije mesha (CCD czasem nie łapie na krzywiźnie).
 * Margin musi zostać mały (cm) żeby nie odrywać od powierzchni.
 * @param softKill — ile składowej radialnej (na zewnątrz) zabić w soft zone (0..1).
 * @param bounceRetain — przy hard clamp: odbicie radialne (0 = absorb, 1 = pełne).
 */
export function constrainBodyToMeridianSphere(
	body: RAPIER.RigidBody,
	margin: number,
	opts?: { softKill?: number; bounceRetain?: number },
): void {
	if (!active) return;
	const softKill = opts?.softKill ?? 0.85;
	const bounceRetain = opts?.bounceRetain ?? 0;
	const t = body.translation();
	_containScratch.set(t.x, t.y, t.z).sub(active.center);
	const maxR = active.radius - margin;
	const dist = _containScratch.length();
	if (dist < 1e-6) return;

	/** Soft zone: zbliżenie do skorupy od środka z prędkością na zewnątrz. */
	if (dist > maxR * 0.97 && dist <= maxR) {
		const v = body.linvel();
		_normalScratch.copy(_containScratch).normalize();
		const vn =
			v.x * _normalScratch.x +
			v.y * _normalScratch.y +
			v.z * _normalScratch.z;
		if (vn > 0.05 && softKill > 0) {
			body.setLinvel(
				{
					x: v.x - _normalScratch.x * vn * softKill,
					y: v.y - _normalScratch.y * vn * softKill,
					z: v.z - _normalScratch.z * vn * softKill,
				},
				true,
			);
		}
		return;
	}

	if (dist <= maxR) return;

	_containScratch.multiplyScalar(maxR / dist);
	body.setTranslation(
		{
			x: active.center.x + _containScratch.x,
			y: active.center.y + _containScratch.y,
			z: active.center.z + _containScratch.z,
		},
		true,
	);

	const v = body.linvel();
	_normalScratch.copy(_containScratch).normalize();
	const vn =
		v.x * _normalScratch.x + v.y * _normalScratch.y + v.z * _normalScratch.z;
	if (vn > 0) {
		const reflected = bounceRetain > 0 ? -vn * bounceRetain : 0;
		const delta = vn - reflected;
		body.setLinvel(
			{
				x: v.x - _normalScratch.x * delta,
				y: v.y - _normalScratch.y * delta,
				z: v.z - _normalScratch.z * delta,
			},
			true,
		);
	}
}
