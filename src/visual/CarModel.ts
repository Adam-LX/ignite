import * as THREE from "three";
import {
		type CarCatalogEntry,
		getCarCatalogSync,
		getDefaultCarId,
		loadCarCatalog,
		primeCarCatalog,
		resolveCarGlbPath,
		resolveCarId,
	} from "../meta/CarCatalog";
import { createGltfLoader } from "../util/gltfLoader";
import { alignCarToHitbox } from "./carGlbLoader";
import { createCarChromeMaterial } from "./carPanelMaterial";
import {
	finalizeCarGroundAlign,
	measureWheelRadius,
	snapAllWheelsToGround,
	wheelGroundTargetY,
} from "./carWheelGround";
import {
	ensureMeshyGltfAxes,
	enforceBodyMaterialsFrontSide,
	ensureMeshyCarNosePlusZ,
	meshyRearTowardPlusZ,
	bakeCarRootTransform,
	centerCarOnHorizontalOrigin,
	flattenCarContentToRoot,
} from "./trellisCarOrientation";
import {
	prepareCarWheelWellsForLoad,
	prepareEmptyWheelWellsBeforeGroundAlign,
	repositionEmptyWheelHubsFromBody,
} from "./wheelMount";
import { getMeshyCarModelUrl } from "./meshyArenaAssets";
import {
		CAR_VISUAL_SCALE,
		OCTANE_LENGTH,
		OCTANE_VISUAL_WIDTH,
		wheelTrackHalfWidth,
	} from "./octaneCarMesh";
import { sanitizeCarVisuals } from "./sanitizeCar";
import { hideShowcaseGhostMeshes } from "./showcaseSceneAudit";
	
const cachedBase = new Map<string, THREE.Group>();
/** Podbij po zmianie GLB / logiki kół — unieważnia cache w pamięci. */
const CAR_GLB_CACHE_TAG = "wheels-v92-puls-nose";

/**
 * Ręczne wyjątki gdy detektor nosa się myli (Trellis / Meshy).
 * true = wymuś yaw 180°; false = zablokuj auto-yaw; brak wpisu = auto.
 *
 * octane (Puls): to van — wysoka kabina = PRZÓD, nie tył. Detektor
 * (wysoki koniec = tył) jest odwrotny; FORCE 180 ustawia kabinę na +Z.
 * finalize NIE może potem odwracać detektorem (to był bug przód↔tył).
 */
const FORCE_YAW_180: Record<string, boolean> = {
	octane: true,
};

function applyMeshyNoseYaw(car: THREE.Object3D, carId: string): void {
	const forced = FORCE_YAW_180[carId];
	if (forced === true) {
		car.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
		car.updateMatrixWorld(true);
		return;
	}
	if (forced === false) return;
	ensureMeshyCarNosePlusZ(car);
}

/** Po bake/flatten — detekcja nosa w identity space (fizyka = lokalne +Z). */
function finalizeMeshyNosePlusZ(car: THREE.Object3D, carId: string): void {
	/** Ręczny override — nie pozwalaj detektorowi cofnąć FORCE_YAW_180. */
	if (FORCE_YAW_180[carId] !== undefined) return;
	if (!meshyRearTowardPlusZ(car)) return;
	car.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
	car.updateMatrixWorld(true);
	bakeCarRootTransform(car);
}
	
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
	
const WHEEL_NAMES = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;
const _sampleV = new THREE.Vector3();
	
function normalizeWheelRigs(root: THREE.Object3D): void {
		for (const name of WHEEL_NAMES) {
			const wheel = root.getObjectByName(name);
			if (!wheel) continue;
	
			let rim = wheel.getObjectByName(`${name}_rim`);
			if (!rim) rim = root.getObjectByName(`${name}_rim`);
			if (rim && rim.parent !== wheel) {
				wheel.attach(rim);
			}
		}
	}
	
/** Szerokość nadkola w pasmie Z (nie cały bbox — ważne przy szerokim tylku). */
function sampleFenderHalfWidth(
		body: THREE.Mesh,
		targetZ: number,
		bodyBox: THREE.Box3,
		zBand = 0.1,
		maxYFrac = 0.52,
	): number {
		const pos = body.geometry.attributes.position;
		if (!pos) return wheelTrackHalfWidth(bodyBox.max.x - bodyBox.min.x);
	
		body.updateMatrixWorld(true);
		const yMax = bodyBox.min.y + (bodyBox.max.y - bodyBox.min.y) * maxYFrac;
		let minX = Infinity;
		let maxX = -Infinity;
		let hits = 0;
	
		for (let i = 0; i < pos.count; i++) {
			_sampleV.fromBufferAttribute(pos, i);
			_sampleV.applyMatrix4(body.matrixWorld);
			if (Math.abs(_sampleV.z - targetZ) > zBand) continue;
			if (_sampleV.y > yMax) continue;
			minX = Math.min(minX, _sampleV.x);
			maxX = Math.max(maxX, _sampleV.x);
			hits++;
		}
	
		if (hits < 12 || !Number.isFinite(minX)) {
			return wheelTrackHalfWidth(bodyBox.max.x - bodyBox.min.x);
		}
		return wheelTrackHalfWidth(maxX - minX);
	}
	
function renameWheels(root: THREE.Object3D): void {
		root.traverse((obj) => {
			const next = WHEEL_RENAME[obj.name] ?? WHEEL_RENAME[obj.name.toLowerCase()];
			if (next) obj.name = next;
		});
	}
	
function fitToHitboxScale(root: THREE.Group, meshyBody = false): void {
		root.updateMatrixWorld(true);
		const body = root.getObjectByName("body");
		if (meshyBody && body instanceof THREE.Mesh) {
			fitMeshyBodyAndWheels(root, body);
			return;
		}
	
		const measure = body ?? root;
		measure.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(measure);
		const size = box.getSize(new THREE.Vector3());
		const scale = Math.min(OCTANE_VISUAL_WIDTH / size.x, OCTANE_LENGTH / size.z);
		root.scale.multiplyScalar(scale * CAR_VISUAL_SCALE);
	
		if (body && !meshyBody) body.scale.multiplyScalar(1.16);
	}
	
/** Skala wizualna — CAR_VISUAL_SCALE tylko gdy limituje długość (jak octane). */
export function computeMeshyVisualScale(size: {
		x: number;
		z: number;
	}): number {
		const scaleX = OCTANE_VISUAL_WIDTH / size.x;
		const scaleZ = OCTANE_LENGTH / size.z;
		const fit = Math.min(scaleX, scaleZ);
		const widthLimited = scaleX <= scaleZ;
		return fit * (widthLimited ? 1 : CAR_VISUAL_SCALE);
	}
	
function applyMeshyVisualScale(root: THREE.Group, body: THREE.Mesh): void {
		body.updateMatrixWorld(true);
		const size = new THREE.Box3()
			.setFromObject(body)
			.getSize(new THREE.Vector3());
		root.scale.multiplyScalar(computeMeshyVisualScale(size));
	}
	
/** Skala hitboxa; koła z GLB zostają — Blender prep ustawia je w nadkolach. */
function fitMeshyBodyAndWheels(root: THREE.Group, body: THREE.Mesh): void {
	const carId =
		typeof root.userData.carId === "string" ? root.userData.carId : null;
	ensureMeshyGltfAxes(root, carId);
	/**
	 * Orientacja: ensureMeshyGltfAxes wybiera ±90° po oryginalnych hubach
	 * (PRZED snap/reposition). Nie wołaj ensureTrellisCarUpright po snapie —
	 * huby na murawie fałszywie wyglądają na „OK” przy odwróconym body.
	 */
	enforceBodyMaterialsFrontSide(root);
	const hasBlenderWheels = WHEEL_NAMES.every(
		(n) => root.getObjectByName(n) != null,
	);

	applyMeshyVisualScale(root, body);
		normalizeWheelRigs(root);
	
		const groundY = wheelGroundTargetY(root, true);
	
		if (hasBlenderWheels) {
			snapAllWheelsToGround(root, groundY);
			normalizeWheelRigs(root);
			return;
		}
	
		root.updateMatrixWorld(true);
		const fitted = new THREE.Box3().setFromObject(body);
		const cx = (fitted.min.x + fitted.max.x) * 0.5;
		const cz = (fitted.min.z + fitted.max.z) * 0.5;
		const l = fitted.max.z - fitted.min.z;
		const zFront = cz + l * 0.3;
		const zRear = cz - l * 0.28;
		const wxFront = sampleFenderHalfWidth(body, zFront, fitted);
		const wxRear = sampleFenderHalfWidth(body, zRear, fitted);
	
		for (const [name, pos] of Object.entries({
			wheel_FL: new THREE.Vector3(cx - wxFront, groundY, zFront),
			wheel_FR: new THREE.Vector3(cx + wxFront, groundY, zFront),
			wheel_RL: new THREE.Vector3(cx - wxRear, groundY, zRear),
			wheel_RR: new THREE.Vector3(cx + wxRear, groundY, zRear),
		})) {
			const wheel = root.getObjectByName(name);
			if (!wheel) continue;
			wheel.position.copy(pos);
			const radius = measureWheelRadius(wheel);
			wheel.position.y += radius;
		}
	
		snapAllWheelsToGround(root, groundY);
		normalizeWheelRigs(root);
	}

/** Zachowuje tekstury Meshy — bez iridescence / mocnego emissive (przepalało lakier w garażu). */
function enhanceMeshyBodyMaterial(
		mesh: THREE.Mesh,
		team: "blue" | "orange",
	): void {
		const colors = TEAM_COLORS[team];
		const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
		if (!(src instanceof THREE.MeshStandardMaterial)) return;

		const mat = src.clone();
		mat.metalness = Math.min(0.58, Math.max(0.12, mat.metalness * 0.92));
		mat.roughness = Math.max(0.34, Math.min(0.88, mat.roughness * 1.08 + 0.04));
		mat.envMapIntensity = Math.min(0.95, (mat.envMapIntensity || 1) * 0.85);
		mat.emissive = new THREE.Color(colors.primary);
		mat.emissiveIntensity = Math.min(0.045, mat.emissiveIntensity || 0);
		mat.transparent = false;
		mat.opacity = 1;
		mat.depthWrite = true;

		if (mat instanceof THREE.MeshPhysicalMaterial) {
			mat.clearcoat = Math.min(mat.clearcoat || 0, 0.18);
			mat.clearcoatRoughness = Math.max(mat.clearcoatRoughness || 0, 0.35);
			mat.iridescence = 0;
			mat.transmission = 0;
			mat.thickness = 0;
			mat.specularIntensity = Math.min(mat.specularIntensity ?? 1, 0.65);
		}

		mat.needsUpdate = true;
		mesh.material = mat;
	}
	
const TEAM_COLORS = {
		blue: { primary: 0x1ec8ee, dark: 0x0a8fad },
		orange: { primary: 0xff5522, dark: 0xc93400 },
	} as const;
	
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
		/** AABB w world — przy root.rotation.x ±90° ≠ local. */
		const box = new THREE.Box3().setFromObject(measure);
		const cx = (box.min.x + box.max.x) * 0.5;
		const w = box.max.x - box.min.x;
		const l = box.max.z - box.min.z;
		const h = box.max.y - box.min.y;
		const rearZ = box.min.z + l * 0.04;
		const exhaustY = box.min.y + h * 0.22;
		const _world = new THREE.Vector3();

		const addSocket = (name: string, wx: number, wy: number, wz: number) => {
			if (car.getObjectByName(name)) return;
			const s = new THREE.Object3D();
			s.name = name;
			car.worldToLocal(_world.set(wx, wy, wz));
			s.position.copy(_world);
			car.add(s);
		};

		const lampX = w * 0.34;
		const frontZ = box.max.z - l * 0.08;
		const lampY = box.min.y + h * 0.62;
		addSocket("headlight_L", cx - lampX, lampY, frontZ);
		addSocket("headlight_R", cx + lampX, lampY, frontZ);

		addSocket("exhaust_C", cx, exhaustY, rearZ);
		addSocket("exhaust_L", box.min.x + w * 0.18, exhaustY, rearZ + l * 0.02);
		addSocket("exhaust_R", box.max.x - w * 0.18, exhaustY, rearZ + l * 0.02);
	}
	
function resolveCatalogEntry(carId: string): CarCatalogEntry {
		const id = resolveCarId(carId);
		return getCarEntryOrDefault(id);
	}
	
function getCarEntryOrDefault(carId: string): CarCatalogEntry {
		return (
			getCarCatalogSync().cars.find((c) => c.id === carId) ??
			getCarCatalogSync().cars.find((c) => c.id === getDefaultCarId())!
		);
	}
	
function catalogModelUrl(
		entry: CarCatalogEntry,
		team: "blue" | "orange",
	): string {
		if (entry.id === getDefaultCarId()) {
			const meshy = getMeshyCarModelUrl(team);
			if (meshy) return meshy;
		}
		return resolveCarGlbPath(entry, team);
	}
	
async function fetchBaseModel(
		carId: string,
		team: "blue" | "orange",
	): Promise<THREE.Group> {
		await loadCarCatalog();
		const entry = resolveCatalogEntry(carId);
		const url = catalogModelUrl(entry, team);
		const cacheKey = `${CAR_GLB_CACHE_TAG}:${entry.id}:${team}:${url}`;
		const cached = cachedBase.get(cacheKey);
		if (cached) return cached.clone(true);
	
		const loader = createGltfLoader();
		const fallbackEntry = getCarEntryOrDefault(getDefaultCarId());
		const fallbackUrl = catalogModelUrl(fallbackEntry, team);
	
		try {
			const gltf = await loader.loadAsync(url);
			const model = gltf.scene;
			model.name = `${entry.id}Car_${team}`;
			model.userData.carId = entry.id;
			renameWheels(model);
			cachedBase.set(cacheKey, model);
			return model.clone(true);
		} catch (err) {
			if (url !== fallbackUrl) {
				console.error(
					`[Ignite] GLB ${entry.id} NIE ZAŁADOWAŁ SIĘ (${url}) — widać ${fallbackEntry.id}. Sprawdź plik.`,
					err,
				);
				const fallback = await fetchBaseModel(getDefaultCarId(), team);
				fallback.userData.carId = fallbackEntry.id;
				fallback.userData.loadFallbackFrom = entry.id;
				return fallback;
			}
			throw err;
		}
	}
	
/** Prefetch GLB z katalogu — cache przed pierwszym spawnem aut. */
export function preloadCarMeshes(): void {
		void primeCarCatalog().then((catalog) => {
			for (const entry of catalog.cars) {
				for (const team of ["blue", "orange"] as const) {
					void fetchBaseModel(entry.id, team).catch(() => {
						/* brak pliku — fallback w loadCarModel */
					});
				}
			}
		});
	}
	
export async function loadCarModel(
		carId: string = getDefaultCarId(),
		team: "blue" | "orange" = "blue",
	): Promise<THREE.Group> {
		const car = (await fetchBaseModel(resolveCarId(carId), team)) as THREE.Group;
	
		const chromeMat = createCarChromeMaterial(team);
	
		const rubberMat = new THREE.MeshStandardMaterial({
			color: 0x101010,
			metalness: 0.05,
			roughness: 0.92,
		});
	
		const bodyMesh = car.getObjectByName("body");
		const meshyBody =
			bodyMesh instanceof THREE.Mesh && car.getObjectByName("wheel_FL") != null;
	
		car.traverse((obj) => {
			obj.frustumCulled = false;
			if (!(obj instanceof THREE.Mesh)) return;
			obj.geometry?.computeBoundingSphere();
			obj.castShadow = true;
			obj.receiveShadow = true;
	
			const n = obj.name.toLowerCase();
			if (n.includes("_rim")) return;
			if (n.startsWith("wheel_") || (n.includes("wheel") && n !== "body")) {
				if (!n.includes("_rim")) obj.material = rubberMat;
				return;
			}
			if (obj.name === "body" && meshyBody) {
				enhanceMeshyBodyMaterial(obj, team);
				return;
			}
			/** Trellis: nie podmieniaj trimów na iridescent chrome — przepala kolory. */
			if (meshyBody) {
				const src = Array.isArray(obj.material) ? obj.material[0] : obj.material;
				if (src instanceof THREE.MeshStandardMaterial) {
					const mat = src.clone();
					mat.metalness = Math.min(mat.metalness, 0.55);
					mat.roughness = Math.max(mat.roughness, 0.28);
					mat.envMapIntensity = Math.min(mat.envMapIntensity || 1, 0.9);
					mat.emissiveIntensity = Math.min(mat.emissiveIntensity, 0.06);
					if (mat instanceof THREE.MeshPhysicalMaterial) {
						mat.iridescence = 0;
						mat.clearcoat = Math.min(mat.clearcoat || 0, 0.2);
					}
					mat.needsUpdate = true;
					obj.material = mat;
				}
				return;
			}
			obj.material = chromeMat;
		});
	
	sanitizeCarVisuals(car);
	fitToHitboxScale(car, meshyBody);
	if (meshyBody) {
		const id = resolveCarId(carId);
		prepareEmptyWheelWellsBeforeGroundAlign(car, id);
		applyMeshyNoseYaw(car, id);
		bakeCarRootTransform(car);
		flattenCarContentToRoot(car);
		centerCarOnHorizontalOrigin(car);
		finalizeMeshyNosePlusZ(car, id);
		centerCarOnHorizontalOrigin(car);
		repositionEmptyWheelHubsFromBody(car, id);
		} else {
			normalizeWheelRigs(car);
		}
		finalizeCarGroundAlign(car, meshyBody);
		prepareCarWheelWellsForLoad(car, resolveCarId(carId));
		alignCarToHitbox(car);
	if (!meshyBody) addTeamAccents(car, team);
	addCarSockets(car);
	sanitizeCarVisuals(car);
	/** Ghost-hide tylko showcase/thumbnail — w meczu nie ukrywaj body (trans/mask). */

		const displayGroup = new THREE.Group();
		displayGroup.name = "octaneCarDisplay";
		const resolvedId = resolveCarId(carId);
		const actualId =
			typeof car.userData.carId === "string" ? car.userData.carId : resolvedId;
		const loadFallbackFrom =
			typeof car.userData.loadFallbackFrom === "string"
				? car.userData.loadFallbackFrom
				: null;
		displayGroup.userData.carId = actualId;
		displayGroup.userData.requestedCarId = resolvedId;
		if (loadFallbackFrom) {
			displayGroup.userData.loadFallbackFrom = loadFallbackFrom;
			console.error(
				`[Ignite] Model ${resolvedId} zastąpiony przez ${actualId} (brak GLB)`,
			);
		}
		car.userData.carId = actualId;
		displayGroup.add(car);
	
		return displayGroup;
	}

/** Miniaturka garażu — tekstury z GLB, bez team chrome / cyan emissive. */
export async function loadCarThumbnailModel(
	carId: string = getDefaultCarId(),
): Promise<THREE.Group> {
	const resolvedId = resolveCarId(carId);
	const car = (await fetchBaseModel(resolvedId, "blue")) as THREE.Group;

	const rubberMat = new THREE.MeshStandardMaterial({
		color: 0x101010,
		metalness: 0.05,
		roughness: 0.92,
	});

	const bodyMesh = car.getObjectByName("body");
	const meshyBody =
		bodyMesh instanceof THREE.Mesh && car.getObjectByName("wheel_FL") != null;

	car.traverse((obj) => {
		obj.frustumCulled = false;
		if (!(obj instanceof THREE.Mesh)) return;
		obj.geometry?.computeBoundingSphere();
		const n = obj.name.toLowerCase();
		if (n.includes("_rim")) return;
		if (n.startsWith("wheel_") || (n.includes("wheel") && n !== "body")) {
			if (!n.includes("_rim")) obj.material = rubberMat;
		}
	});

	sanitizeCarVisuals(car);
	fitToHitboxScale(car, meshyBody);
	if (meshyBody) {
		prepareEmptyWheelWellsBeforeGroundAlign(car, resolvedId);
		applyMeshyNoseYaw(car, resolvedId);
		bakeCarRootTransform(car);
		flattenCarContentToRoot(car);
		centerCarOnHorizontalOrigin(car);
		finalizeMeshyNosePlusZ(car, resolvedId);
		centerCarOnHorizontalOrigin(car);
		repositionEmptyWheelHubsFromBody(car, resolvedId);
	} else {
		normalizeWheelRigs(car);
	}
	finalizeCarGroundAlign(car, meshyBody);
	prepareCarWheelWellsForLoad(car, resolvedId);
	/** Bez maski na pustych hubach — trellis ma już cutouty; maska wycina kabinę. */
	sanitizeCarVisuals(car);
	if (meshyBody) hideShowcaseGhostMeshes(car);

	const displayGroup = new THREE.Group();
	displayGroup.name = "carThumbnailDisplay";
	displayGroup.userData.carId = resolvedId;
	displayGroup.add(car);
	return displayGroup;
}
	
export async function buildCarModel(
		carId: string = getDefaultCarId(),
		team: "blue" | "orange" = "blue",
	): Promise<THREE.Group> {
		return loadCarModel(carId, team);
	}
