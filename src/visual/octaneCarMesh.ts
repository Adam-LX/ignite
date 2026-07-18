import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Wymiary hitboxa Octane w RL: 118 × 84 × 36 uu → metry. */
export const OCTANE_LENGTH = 1.18;
export const OCTANE_WIDTH = 0.84;
export const OCTANE_BODY_HEIGHT = 0.36;
export const OCTANE_VISUAL_WIDTH = 0.68;
/** Wspólny mnożnik wizualny (mesh + procedural) — lekko ponad hitbox. */
export const CAR_VISUAL_SCALE = 1.42;

const TIRE_RADIUS = 0.125;
const TIRE_WIDTH = 0.088;
/** Ułamek promienia koła pod bokiem karoserii (wyżej = głębiej w nadkolu). */
export const WHEEL_LATERAL_TUCK = 1.02;

/** Odległość środka koła od osi auta (X) — promień liczony od boku bbox. */
export function wheelTrackHalfWidth(bodyWidth: number): number {
	return bodyWidth * 0.5 - TIRE_RADIUS * WHEEL_LATERAL_TUCK;
}
const BODY_WIDTH = 0.64;
const WING_WIDTH = 0.68;
const ROUND_SEGMENTS = 20;

const TEAM_BODY = { blue: 0x1ec8ee, orange: 0xff5522 } as const;
const TEAM_NEON = {
	blue: { glow: 0x7aff2a, stripe: 0xddff44, rim: 0x55eeff, skirt: 0x62f028 },
	orange: { glow: 0xffcc22, stripe: 0xffff88, rim: 0xffaa44, skirt: 0xff8800 },
} as const;

const BEVEL_M = 0.038;
const BEVEL_S = 0.024;

function finalizeGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
	geo.computeVertexNormals();
	return geo;
}

function clampBevel(w: number, h: number, d: number, bevel: number): number {
	return Math.min(bevel, w * 0.28, h * 0.28, d * 0.28);
}

function meshRounded(
	w: number,
	h: number,
	d: number,
	mat: THREE.Material,
	x: number,
	y: number,
	z: number,
	rx = 0,
	ry = 0,
	rz = 0,
	bevel = BEVEL_M,
): THREE.Mesh {
	const geo = finalizeGeometry(
		new RoundedBoxGeometry(w, h, d, ROUND_SEGMENTS, clampBevel(w, h, d, bevel)),
	);
	const m = new THREE.Mesh(geo, mat);
	m.position.set(x, y, z);
	m.rotation.set(rx, ry, rz);
	return m;
}

function createPaint(team: "blue" | "orange"): THREE.MeshStandardMaterial {
	const hex = TEAM_BODY[team];
	return new THREE.MeshStandardMaterial({
		color: hex,
		metalness: 0.5,
		roughness: 0.22,
		emissive: new THREE.Color(hex).multiplyScalar(0.06),
		emissiveIntensity: 1.2,
	});
}

function createSkirt(team: "blue" | "orange"): THREE.MeshStandardMaterial {
	const hex = TEAM_NEON[team].skirt;
	return new THREE.MeshStandardMaterial({
		color: hex,
		emissive: hex,
		emissiveIntensity: 1.8,
	});
}

function createGlass(): THREE.MeshPhysicalMaterial {
	return new THREE.MeshPhysicalMaterial({
		color: 0x060a12,
		metalness: 0.1,
		roughness: 0.05,
		transparent: true,
		opacity: 0.88,
		clearcoat: 1,
	});
}

function addWheel(
	parent: THREE.Object3D,
	x: number,
	z: number,
	name: string,
	team: "blue" | "orange",
): void {
	const tireMat = new THREE.MeshStandardMaterial({
		color: 0x0a0a0a,
		roughness: 0.85,
	});
	const rimMat = new THREE.MeshStandardMaterial({
		color: 0x888890,
		metalness: 0.9,
		roughness: 0.15,
		emissive: new THREE.Color(TEAM_NEON[team].rim).multiplyScalar(0.08),
	});
	const wheel = new THREE.Group();
	wheel.name = name;
	const tire = new THREE.Mesh(
		finalizeGeometry(
			new THREE.CylinderGeometry(TIRE_RADIUS, TIRE_RADIUS, TIRE_WIDTH, 32),
		),
		tireMat,
	);
	tire.rotation.z = Math.PI / 2;
	const rim = new THREE.Mesh(
		finalizeGeometry(
			new THREE.CylinderGeometry(
				TIRE_RADIUS * 0.68,
				TIRE_RADIUS * 0.68,
				TIRE_WIDTH + 0.006,
				16,
			),
		),
		rimMat,
	);
	rim.rotation.z = Math.PI / 2;
	wheel.add(tire, rim);
	wheel.position.set(x, TIRE_RADIUS, z);
	parent.add(wheel);
}

function applyVisualScale(car: THREE.Group): void {
	const box = new THREE.Box3().setFromObject(car);
	const size = box.getSize(new THREE.Vector3());
	car.scale.set(OCTANE_VISUAL_WIDTH / size.x, 1, OCTANE_LENGTH / size.z);
}

/** Proceduralny fallback — prosty, bez blobów. */
export function buildOctaneMesh(team: "blue" | "orange" = "blue"): THREE.Group {
	const car = new THREE.Group();
	car.name = "octaneCar";
	const paint = createPaint(team);
	const skirt = createSkirt(team);
	const glass = createGlass();
	const bw = BODY_WIDTH;

	const hull = new THREE.Group();
	hull.name = "carHull";
	hull.add(
		meshRounded(bw * 0.98, 0.15, 0.9, paint, 0, 0.22, -0.02, 0, 0, 0, BEVEL_M),
	);
	hull.add(
		meshRounded(
			bw * 0.86,
			0.1,
			0.48,
			paint,
			0,
			0.24,
			0.2,
			-0.05,
			0,
			0,
			BEVEL_M,
		),
	);
	hull.add(
		meshRounded(
			bw * 0.62,
			0.07,
			0.22,
			paint,
			0,
			0.19,
			0.52,
			-0.1,
			0,
			0,
			BEVEL_S,
		),
	);
	hull.add(
		meshRounded(bw * 0.78, 0.12, 0.28, glass, 0, 0.35, 0, -0.18, 0, 0, BEVEL_S),
	);
	hull.add(
		meshRounded(
			bw * 1.0,
			0.06,
			0.88,
			skirt,
			0,
			TIRE_RADIUS + 0.05,
			-0.02,
			0,
			0,
			0,
			BEVEL_S,
		),
	);
	hull.add(
		meshRounded(
			WING_WIDTH,
			0.028,
			0.1,
			paint,
			0,
			0.38,
			-0.52,
			0.04,
			0,
			0,
			BEVEL_S,
		),
	);
	car.add(hull);

	const wx = wheelTrackHalfWidth(bw);
	addWheel(car, -wx, OCTANE_LENGTH * 0.28, "wheel_FL", team);
	addWheel(car, wx, OCTANE_LENGTH * 0.28, "wheel_FR", team);
	addWheel(car, -wx, -OCTANE_LENGTH * 0.28, "wheel_RL", team);
	addWheel(car, wx, -OCTANE_LENGTH * 0.28, "wheel_RR", team);

	const lampX = bw * 0.38;
	for (const [name, sx] of [
		["headlight_L", -1],
		["headlight_R", 1],
	] as const) {
		const s = new THREE.Object3D();
		s.name = name;
		s.position.set(sx * lampX, 0.26, 0.58);
		car.add(s);
	}

	car.traverse((obj) => {
		if (obj instanceof THREE.Mesh) {
			obj.castShadow = true;
			obj.receiveShadow = true;
		}
	});

	applyVisualScale(car);
	return car;
}
