import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "../util/assetUrl";
import { alignCarToHitbox } from "./carGlbLoader";
import { OCTANE_LENGTH, OCTANE_VISUAL_WIDTH } from "./octaneCarMesh";

const GLB_PATH = assetUrl("/assets/models/car.glb");
let cachedBase: THREE.Group | null = null;

const WHEEL_RENAME: Record<string, string> = {
	WheelFrontL: "wheel_FL",
	WheelFrontR: "wheel_FR",
	WheelRearL: "wheel_RL",
	WheelRearR: "wheel_RR",
	"wheel-front-left": "wheel_FL",
	"wheel-front-right": "wheel_FR",
	"wheel-back-left": "wheel_RL",
	"wheel-back-right": "wheel_RR",
	wheel_front_left: "wheel_FL",
	wheel_front_right: "wheel_FR",
	wheel_back_left: "wheel_RL",
	wheel_back_right: "wheel_RR",
	wheel_fl: "wheel_FL",
	wheel_fr: "wheel_FR",
	wheel_rl: "wheel_RL",
	wheel_rr: "wheel_RR",
};

function renameWheels(root: THREE.Object3D): void {
	root.traverse((obj) => {
		const next = WHEEL_RENAME[obj.name] ?? WHEEL_RENAME[obj.name.toLowerCase()];
		if (next) obj.name = next;
	});
}

function fitToHitboxScale(root: THREE.Group): void {
	root.updateMatrixWorld(true);
	const body = root.getObjectByName("body");
	const measure = body ?? root;
	measure.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(measure);
	const size = box.getSize(new THREE.Vector3());
	const scale = Math.min(OCTANE_VISUAL_WIDTH / size.x, OCTANE_LENGTH / size.z);
	root.scale.multiplyScalar(scale);

	// Powiększ karoserię względem kół (nie skalujemy całego auta).
	if (body) body.scale.multiplyScalar(1.16);
}

const TEAM_COLORS = {
	blue: { primary: 0x1ec8ee, dark: 0x0a8fad },
	orange: { primary: 0xff5522, dark: 0xc93400 },
} as const;

/** Podwozie w kolorze drużyny — boczne progi / splitter, bez płaskiej płyty od spodu. */
function addTeamUnderbody(car: THREE.Group, team: "blue" | "orange"): void {
	const colors = TEAM_COLORS[team];
	const primaryMat = new THREE.MeshStandardMaterial({
		color: colors.primary,
		emissive: new THREE.Color(colors.primary),
		emissiveIntensity: 0.7,
		metalness: 0.42,
		roughness: 0.26,
	});
	const darkMat = new THREE.MeshStandardMaterial({
		color: colors.dark,
		emissive: new THREE.Color(colors.dark),
		emissiveIntensity: 0.45,
		metalness: 0.38,
		roughness: 0.3,
	});

	car.updateMatrixWorld(true);
	const body = car.getObjectByName("body");
	const measure = body ?? car;
	measure.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(measure);
	const cx = (box.min.x + box.max.x) * 0.5;
	const cz = (box.min.z + box.max.z) * 0.5;
	const w = box.max.x - box.min.x;
	const l = box.max.z - box.min.z;
	const h = box.max.y - box.min.y;
	const bellyY = box.min.y + h * 0.03;

	const under = new THREE.Group();
	under.name = "teamUnderbody";

	const addPart = (
		name: string,
		geo: THREE.BufferGeometry,
		mat: THREE.Material,
		x: number,
		y: number,
		z: number,
	) => {
		const mesh = new THREE.Mesh(geo, mat);
		mesh.name = name;
		mesh.position.set(x, y, z);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		under.add(mesh);
	};

	const rockerH = h * 0.055;
	const rockerL = l * 0.7;
	const rockerT = 0.016;
	addPart(
		"rocker_L",
		new THREE.BoxGeometry(rockerT, rockerH, rockerL),
		primaryMat,
		box.min.x + rockerT * 0.55,
		bellyY + rockerH * 0.45,
		cz,
	);
	addPart(
		"rocker_R",
		new THREE.BoxGeometry(rockerT, rockerH, rockerL),
		primaryMat,
		box.max.x - rockerT * 0.55,
		bellyY + rockerH * 0.45,
		cz,
	);

	const skirtH = h * 0.08;
	addPart(
		"under_skirt_L",
		new THREE.BoxGeometry(rockerT, skirtH, rockerL * 0.92),
		darkMat,
		box.min.x + w * 0.04,
		bellyY + skirtH * 0.42,
		cz,
	);
	addPart(
		"under_skirt_R",
		new THREE.BoxGeometry(rockerT, skirtH, rockerL * 0.92),
		darkMat,
		box.max.x - w * 0.04,
		bellyY + skirtH * 0.42,
		cz,
	);

	addPart(
		"under_front",
		new THREE.BoxGeometry(w * 0.58, h * 0.022, l * 0.07),
		darkMat,
		cx,
		bellyY + h * 0.012,
		box.max.z - l * 0.045,
	);
	addPart(
		"under_rear",
		new THREE.BoxGeometry(w * 0.52, h * 0.02, l * 0.06),
		primaryMat,
		cx,
		bellyY + h * 0.01,
		box.min.z + l * 0.045,
	);

	car.add(under);
}

/** Paski / wstawki w kolorze drużyny — czytelne z dystansu, chrom zostaje na karoserii. */
function addTeamAccents(car: THREE.Group, team: "blue" | "orange"): void {
	const colors = TEAM_COLORS[team];
	const accentMat = new THREE.MeshStandardMaterial({
		color: colors.primary,
		emissive: new THREE.Color(colors.primary),
		emissiveIntensity: 0.9,
		metalness: 0.4,
		roughness: 0.22,
	});
	const darkMat = new THREE.MeshStandardMaterial({
		color: colors.dark,
		emissive: new THREE.Color(colors.dark),
		emissiveIntensity: 0.55,
		metalness: 0.35,
		roughness: 0.28,
	});

	car.updateMatrixWorld(true);
	const body = car.getObjectByName("body");
	const measure = body ?? car;
	measure.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(measure);
	const cx = (box.min.x + box.max.x) * 0.5;
	const cz = (box.min.z + box.max.z) * 0.5;
	const w = box.max.x - box.min.x;
	const l = box.max.z - box.min.z;
	const h = box.max.y - box.min.y;
	const midY = box.min.y + h * 0.38;

	const trim = new THREE.Group();
	trim.name = "teamAccents";

	const addPart = (
		name: string,
		geo: THREE.BufferGeometry,
		mat: THREE.Material,
		x: number,
		y: number,
		z: number,
	) => {
		const mesh = new THREE.Mesh(geo, mat);
		mesh.name = name;
		mesh.position.set(x, y, z);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		trim.add(mesh);
	};

	const stripeH = h * 0.07;
	const stripeL = l * 0.52;
	const stripeT = 0.012;
	addPart(
		"team_stripe_L",
		new THREE.BoxGeometry(stripeT, stripeH, stripeL),
		accentMat,
		box.min.x + w * 0.07,
		midY,
		cz,
	);
	addPart(
		"team_stripe_R",
		new THREE.BoxGeometry(stripeT, stripeH, stripeL),
		accentMat,
		box.max.x - w * 0.07,
		midY,
		cz,
	);

	addPart(
		"team_hood",
		new THREE.BoxGeometry(w * 0.28, h * 0.045, l * 0.09),
		accentMat,
		cx,
		box.max.y - h * 0.11,
		box.max.z - l * 0.1,
	);
	addPart(
		"team_spoiler",
		new THREE.BoxGeometry(w * 0.62, h * 0.035, l * 0.055),
		darkMat,
		cx,
		box.max.y - h * 0.06,
		box.min.z + l * 0.07,
	);

	car.add(trim);
}

/** Punkty emiterów — światła, wydech boostu (Kenney GLB ich nie ma). */
function addCarSockets(car: THREE.Group): void {
	car.updateMatrixWorld(true);
	const body = car.getObjectByName("body");
	const measure = body ?? car;
	measure.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(measure);
	const cx = (box.min.x + box.max.x) * 0.5;
	const w = box.max.x - box.min.x;
	const l = box.max.z - box.min.z;
	const h = box.max.y - box.min.y;
	const rearZ = box.min.z + l * 0.04;
	const exhaustY = box.min.y + h * 0.22;

	const addSocket = (name: string, x: number, y: number, z: number) => {
		if (car.getObjectByName(name)) return;
		const s = new THREE.Object3D();
		s.name = name;
		s.position.set(x, y, z);
		car.add(s);
	};

	const lampX = w * 0.34;
	const frontZ = box.max.z - l * 0.08;
	const lampY = box.min.y + h * 0.62;
	addSocket("headlight_L", -lampX, lampY, frontZ);
	addSocket("headlight_R", lampX, lampY, frontZ);

	addSocket("exhaust_C", cx, exhaustY, rearZ);
	addSocket("exhaust_L", box.min.x + w * 0.18, exhaustY, rearZ + l * 0.02);
	addSocket("exhaust_R", box.max.x - w * 0.18, exhaustY, rearZ + l * 0.02);
}

async function fetchBaseModel(): Promise<THREE.Group> {
	if (cachedBase) return cachedBase.clone(true);
	const loader = new GLTFLoader();
	const gltf = await loader.loadAsync(GLB_PATH);
	const model = gltf.scene;
	model.name = "octaneCar";
	renameWheels(model);
	cachedBase = model;
	return model.clone(true);
}

export async function loadCarModel(
	team: "blue" | "orange" = "blue",
): Promise<THREE.Group> {
	const car = (await fetchBaseModel()) as THREE.Group;

	const chromeMat = new THREE.MeshStandardMaterial({
		color: 0xdcdcdc,
		metalness: 0.9,
		roughness: 0.15,
	});

	const rubberMat = new THREE.MeshStandardMaterial({
		color: 0x101010,
		metalness: 0.05,
		roughness: 0.92,
	});

	const rimMat = new THREE.MeshStandardMaterial({
		color: TEAM_COLORS[team].primary,
		emissive: new THREE.Color(TEAM_COLORS[team].primary),
		emissiveIntensity: 0.35,
		metalness: 0.55,
		roughness: 0.3,
	});

	car.traverse((obj) => {
		obj.frustumCulled = false;
		if (!(obj instanceof THREE.Mesh)) return;
		obj.geometry?.computeBoundingSphere();
		obj.castShadow = true;
		obj.receiveShadow = true;

		const n = obj.name.toLowerCase();
		if (n.startsWith("wheel_") || n.includes("wheel")) {
			obj.material = rubberMat;
		} else {
			obj.material = chromeMat;
		}
	});

	fitToHitboxScale(car);
	alignCarToHitbox(car);
	addTeamUnderbody(car, team);
	addTeamAccents(car, team);
	addCarSockets(car);

	for (const name of ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]) {
		const wheel = car.getObjectByName(name);
		if (!wheel) continue;
		wheel.updateMatrixWorld(true);
		const wb = new THREE.Box3().setFromObject(wheel);
		const ws = wb.getSize(new THREE.Vector3());
		const r = Math.min(ws.x, ws.y, ws.z) * 0.46;
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(r, r * 0.07, 8, 24),
			rimMat,
		);
		ring.name = `${name}_rim`;
		ring.rotation.x = Math.PI / 2;
		ring.position.copy(wheel.position);
		ring.position.y += ws.y * 0.02;
		car.add(ring);
	}

	const displayGroup = new THREE.Group();
	displayGroup.name = "octaneCar";
	displayGroup.add(car);

	return displayGroup;
}

export async function buildCarModel(
	team: "blue" | "orange" = "blue",
): Promise<THREE.Group> {
	return loadCarModel(team);
}
