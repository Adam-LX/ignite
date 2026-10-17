import * as THREE from "three";
import {
		type CarCatalogEntry,
		carIsLicensedPreview,
		carUsesEmptyWheelWells,
		getCarCatalogSync,
		getDefaultCarId,
		loadCarCatalog,
		primeCarCatalog,
		resolveCarGlbPath,
		resolveCarId,
	} from "../meta/CarCatalog";
import { createGltfLoader } from "../util/gltfLoader";
import { fitCarVisualToHitbox } from "./CarGrounding";
import { createCarChromeMaterial } from "./carPanelMaterial";
import {
	createNaturalBodyLacquerMaterial,
	enhanceMeshyGlassNightSafe,
	enhanceMeshyTrimNightSafe,
	looksLikeGlassMesh,
	TEAM_BODY_PAINT,
} from "./carBodyLacquer";
import {
	finalizeCarGroundAlign,
	measureWheelRadius,
	snapAllWheelsToGround,
	wheelGroundTargetY,
} from "./carWheelGround";
import {
	ensureMeshyGltfAxes,
	enforceBodyMaterialsFrontSide,
	ensureBodyNormalsOutward,
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
import { createTireRubberMaterial } from "./materials/tireRubberMaterial";
import { hideShowcaseGhostMeshes } from "./showcaseSceneAudit";
import { applyBodyWheelWellMaskForEmptyHubs } from "./bodyWheelWellMask";
	
const cachedBase = new Map<string, THREE.Group>();
/** Podbij po zmianie GLB / logiki kół — unieważnia cache w pamięci. */
const CAR_GLB_CACHE_TAG = "wheels-v110-licensed-doubleside-nogeoclone";

/** @deprecated use carIsLicensedPreview from CarCatalog */
function isLicensedPreviewCar(carId: string): boolean {
	return carIsLicensedPreview(carId);
}

/**
 * GTA/licensed packs often bind glass albedo to UV1; empty UV1 → chroma green.
 * Force maps back to UV0 when geometry has no uv2/uv1.
 */
function fixLicensedTextureUvChannels(root: THREE.Object3D): void {
	const mapKeys = [
		"map",
		"normalMap",
		"roughnessMap",
		"metalnessMap",
		"emissiveMap",
		"aoMap",
		"alphaMap",
	] as const;
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		const geo = obj.geometry;
		const hasUv1 =
			!!geo?.attributes?.uv1 ||
			!!geo?.attributes?.uv2 ||
			!!(geo as THREE.BufferGeometry)?.attributes?.TEXCOORD_1;
		if (hasUv1) return;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const m of mats) {
			if (!(m instanceof THREE.MeshStandardMaterial)) continue;
			let touched = false;
			for (const key of mapKeys) {
				const tex = m[key] as THREE.Texture | null | undefined;
				if (!tex || typeof tex.channel !== "number") continue;
				if (tex.channel === 0) continue;
				tex.channel = 0;
				tex.needsUpdate = true;
				touched = true;
			}
			if (touched) m.needsUpdate = true;
		}
	});
}

/** GTA glass albedo bywa fluoro-zielone — przyciemnij do czytelnej szyby. */
function retintLicensedChromaGlass(root: THREE.Object3D): void {
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		const label = obj.name.toLowerCase();
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		mats.forEach((m, i) => {
			if (!(m instanceof THREE.MeshStandardMaterial)) return;
			const mname = (m.name || "").toLowerCase();
			const isGlass =
				/glass|window|windshield|windscreen/.test(label) ||
				/glass|window/.test(mname);
			if (!isGlass) return;
			const c = m.color;
			const greenHeavy = c.g > 0.4 && c.g > c.r * 1.25 && c.g > c.b * 1.15;
			const emissiveGreen =
				m.emissive.g > 0.35 &&
				m.emissive.g > m.emissive.r * 1.2 &&
				m.emissive.g > m.emissive.b * 1.2;
			if (!greenHeavy && !emissiveGreen && m.map) {
				/** Tekstura może być chroma — i tak przyciemnij tint (zostaw mapę). */
				m.color.setHex(0x1a222c);
				m.emissive.setHex(0x000000);
				m.emissiveIntensity = 0;
				if (m.transparent || m.opacity < 0.98) {
					m.opacity = Math.min(m.opacity, 0.72);
				}
				m.needsUpdate = true;
				return;
			}
			const dark = new THREE.MeshStandardMaterial({
				color: 0x0c141c,
				metalness: 0.05,
				roughness: 0.12,
				transparent: true,
				opacity: 0.58,
				envMapIntensity: 1.35,
				side: THREE.DoubleSide,
				depthWrite: false,
			});
			if (Array.isArray(obj.material)) {
				(obj.material as THREE.Material[])[i] = dark;
			} else {
				obj.material = dark;
			}
		});
	});
}

/**
 * GTA/Sketchfab packs: transmission/BLEND na paint + odwrócone winding.
 * FrontSide → niewidoczna karoseria (zostaje tylko szyba = „duch”).
 * DoubleSide + ubij transmission poza glass.
 */
function hardenLicensedBodyMaterials(root: THREE.Object3D): void {
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		obj.frustumCulled = false;
		obj.visible = true;
		const label = obj.name.toLowerCase();
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const m of mats) {
			if (
				!(
					m instanceof THREE.MeshStandardMaterial ||
					m instanceof THREE.MeshPhysicalMaterial
				)
			) {
				continue;
			}
			const mname = (m.name || "").toLowerCase();
			const isGlass =
				/glass|window|windshield|windscreen/.test(label) ||
				/glass|window/.test(mname);
			if (isGlass) {
				/** Szyba: tani transparent bez transmission (compile hitch). */
				if (m instanceof THREE.MeshPhysicalMaterial) {
					m.transmission = 0;
					m.thickness = 0;
				}
				m.transparent = true;
				m.opacity = Math.min(m.opacity > 0 ? m.opacity : 0.65, 0.72);
				m.depthWrite = false;
				m.side = THREE.DoubleSide;
				m.needsUpdate = true;
				continue;
			}
			/** Grill / badge z alphaMap — zachowaj cutout, nie pełny opaque. */
			const hasAlpha = !!m.alphaMap || m.alphaTest > 0;
			if (hasAlpha) {
				m.transparent = false;
				m.alphaTest = Math.max(m.alphaTest, 0.45);
				m.depthWrite = true;
			} else {
				m.transparent = false;
				m.opacity = 1;
				m.alphaTest = 0;
				m.depthWrite = true;
			}
			if (m instanceof THREE.MeshPhysicalMaterial) {
				m.transmission = 0;
				m.thickness = 0;
			}
			if (m.color.g > 0.55 && m.color.g > m.color.r * 1.3 && m.color.g > m.color.b * 1.2) {
				m.color.setHex(0xc8c8c8);
			}
			/** DoubleSide — GTA FBX często ma odwrócone normals. */
			m.side = THREE.DoubleSide;
			m.needsUpdate = true;
		}
	});
}

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
		/** Licensed / GTA-style packs */
		WHEEL_LF: "wheel_FL",
		WHEEL_RF: "wheel_FR",
		WHEEL_LR: "wheel_RL",
		WHEEL_RR: "wheel_RR",
		wheel_lf: "wheel_FL",
		wheel_rf: "wheel_FR",
		wheel_lr: "wheel_RL",
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
	
function fitToHitboxScale(
		root: THREE.Group,
		meshyBody = false,
		licensed = false,
	): void {
		root.updateMatrixWorld(true);
		const body = root.getObjectByName("body");
		if (meshyBody && body instanceof THREE.Mesh) {
			fitMeshyBodyAndWheels(root, body);
			return;
		}
	
		const measure = licensed ? root : (body ?? root);
		measure.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(measure);
		const size = box.getSize(new THREE.Vector3());
		if (size.x < 1e-4 || size.z < 1e-4) return;
		const scale = Math.min(OCTANE_VISUAL_WIDTH / size.x, OCTANE_LENGTH / size.z);
		root.scale.multiplyScalar(scale * CAR_VISUAL_SCALE);
	
		/** Octane procedural — nie licensed (GTA „body” ≠ cała karoseria). */
		if (body && !meshyBody && !licensed) body.scale.multiplyScalar(1.16);
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

/**
 * Jak miniaturka garażu: oryginalne albedo (lift), bez tinta blue/orange.
 * Team zostaje na underglow / name tag / akcentach proceduralnych.
 */
function enhanceMeshyBodyMaterial(
		mesh: THREE.Mesh,
		_team: "blue" | "orange",
		showcase = false,
	): void {
		const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
		const albedoMap =
			src instanceof THREE.MeshStandardMaterial ? src.map : null;
		const normalMap =
			src instanceof THREE.MeshStandardMaterial ? src.normalMap : null;
		const normalScale =
			src instanceof THREE.MeshStandardMaterial
				? src.normalScale?.clone()
				: undefined;

		mesh.material = createNaturalBodyLacquerMaterial({
			showcase,
			albedoMap,
			normalMap,
			normalScale,
		});
	}

/** Trim Meshy — oryginalne kolory, night-safe (nie płaski szary / chrome-black). */
function enhanceMeshyTrimMaterial(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
	return enhanceMeshyTrimNightSafe(src);
}
	
const TEAM_COLORS = {
		blue: { primary: TEAM_BODY_PAINT.blue, dark: 0x0a8fad },
		orange: { primary: TEAM_BODY_PAINT.orange, dark: 0xc93400 },
	} as const;
	
/** Paski / wstawki w kolorze drużyny — czytelne z dystansu, chrom zostaje na karoserii. */
function addTeamAccents(car: THREE.Group, team: "blue" | "orange"): void {
		const colors = TEAM_COLORS[team];
		const accentMat = new THREE.MeshStandardMaterial({
			color: colors.primary,
			emissive: new THREE.Color(colors.primary),
			emissiveIntensity: 0.65,
			metalness: 0.42,
			roughness: 0.18,
		});
		const darkMat = new THREE.MeshStandardMaterial({
			color: colors.dark,
			emissive: new THREE.Color(colors.dark),
			emissiveIntensity: 0.4,
			metalness: 0.38,
			roughness: 0.24,
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
		if (cached) return cloneCachedCarBase(cached);
	
		const loader = createGltfLoader();
		const fallbackEntry = getCarEntryOrDefault(getDefaultCarId());
		const fallbackUrl = catalogModelUrl(fallbackEntry, team);
	
		try {
			const gltf = await loader.loadAsync(url);
			const model = gltf.scene;
			model.name = `${entry.id}Car_${team}`;
			model.userData.carId = entry.id;
			model.userData.licensedPreview = !!entry.licensedPreview || entry.id.startsWith("lic_");
			/**
			 * NIE rename'uj wheel_lf→wheel_FL na licensed — kosmetyki Octane
			 * (mountWheelGlb / clearHub) wtedy wypruwają stockowe koła.
			 */
			if (!model.userData.licensedPreview) {
				renameWheels(model);
			}
			cachedBase.set(cacheKey, model);
			return cloneCachedCarBase(model);
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

/** clone(true) współdzieli materiały z cache — sklonuj je, zanim loadCarModel je zmutuje. */
function cloneCachedCarBase(source: THREE.Group): THREE.Group {
	const root = source.clone(true) as THREE.Group;
	root.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) return;
		if (Array.isArray(node.material)) {
			node.material = node.material.map((m) => m.clone());
		} else if (node.material) {
			node.material = node.material.clone();
		}
	});
	return root;
}

/** Czy GLB base jest już w RAM (bez fetcha). */
export function isCarBaseCached(
	carId: string,
	team: "blue" | "orange" = "blue",
): boolean {
	try {
		const entry = resolveCatalogEntry(carId);
		const url = catalogModelUrl(entry, team);
		const cacheKey = `${CAR_GLB_CACHE_TAG}:${entry.id}:${team}:${url}`;
		return cachedBase.has(cacheKey);
	} catch {
		return false;
	}
}

/**
 * Prefetch GLB — bez licensed (35–100 MB).
 * Equipped + default + reszta lekkich body.
 */
export function preloadCarMeshes(priorityCarIds: string[] = []): void {
		void primeCarCatalog().then((catalog) => {
			const priority = new Set(
				priorityCarIds.map((id) => resolveCarId(id)).filter(Boolean),
			);
			priority.add(getDefaultCarId());
			const light = catalog.cars.filter((e) => !carIsLicensedPreview(e.id));
			const ordered = [
				...light.filter((e) => priority.has(e.id)),
				...light.filter((e) => !priority.has(e.id)),
			];
			for (const entry of ordered) {
				for (const team of ["blue", "orange"] as const) {
					void fetchBaseModel(entry.id, team).catch(() => {
						/* brak pliku — fallback w loadCarModel */
					});
				}
			}
		});
	}

/** Dopisz equipped (np. po wyborze w garażu) — bez czekania na mecz. */
export function prefetchCarMesh(
	carId: string,
	teams: ReadonlyArray<"blue" | "orange"> = ["blue", "orange"],
): void {
	const id = resolveCarId(carId);
	for (const team of teams) {
		void fetchBaseModel(id, team).catch(() => {
			/* ignore */
		});
	}
}
	
export async function loadCarModel(
		carId: string = getDefaultCarId(),
		team: "blue" | "orange" = "blue",
		opts?: { showcase?: boolean },
	): Promise<THREE.Group> {
		const showcase = opts?.showcase === true;
		const resolvedId = resolveCarId(carId);
		const car = (await fetchBaseModel(resolvedId, team)) as THREE.Group;
		const keepGlbMats = isLicensedPreviewCar(resolvedId);

		const chromeMat = createCarChromeMaterial(team);

		const rubberMat = createTireRubberMaterial();

		const bodyMesh = car.getObjectByName("body");
		const meshyBody =
			!keepGlbMats &&
			bodyMesh instanceof THREE.Mesh &&
			car.getObjectByName("wheel_FL") != null;

		car.traverse((obj) => {
			obj.frustumCulled = false;
			if (!(obj instanceof THREE.Mesh)) return;
			obj.geometry?.computeBoundingSphere();
			obj.castShadow = true;
			obj.receiveShadow = true;

			/** Licensed preview: zostaw paint/glass/chrome z GLB (nie hex chrome). */
			if (keepGlbMats) {
				const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
				for (const m of mats) {
					if (
						m instanceof THREE.MeshStandardMaterial ||
						m instanceof THREE.MeshPhysicalMaterial
					) {
						m.envMapIntensity = Math.max(m.envMapIntensity ?? 1, 1.15);
						m.needsUpdate = true;
					}
				}
				return;
			}

			const n = obj.name.toLowerCase();
			if (n.includes("_rim")) return;
			if (n.startsWith("wheel_") || (n.includes("wheel") && n !== "body")) {
				if (!n.includes("_rim")) obj.material = rubberMat;
				return;
			}
			if (obj.name === "body" && meshyBody) {
				enhanceMeshyBodyMaterial(obj, team, showcase);
				return;
			}
			/** Trellis/Meshy trim — nie chrome; ciemny env + metal = czarne części. */
			if (meshyBody) {
				const src = Array.isArray(obj.material) ? obj.material[0] : obj.material;
				if (src instanceof THREE.MeshStandardMaterial) {
					if (looksLikeGlassMesh(obj.name, src)) {
						obj.material = enhanceMeshyGlassNightSafe(src);
					} else {
						obj.material = enhanceMeshyTrimMaterial(src);
					}
				}
				return;
			}
			obj.material = chromeMat;
		});

	if (keepGlbMats) {
		fixLicensedTextureUvChannels(car);
		hardenLicensedBodyMaterials(car);
		retintLicensedChromaGlass(car);
		car.userData.licensedPreview = true;
		/** Bez sanitize/cosmetics — GTA packs mają „okrągłe” przezroczyste części. */
		fitToHitboxScale(car, false, true);
		finalizeCarGroundAlign(car, false);
		addCarSockets(car);
	} else {
	sanitizeCarVisuals(car);
	fitToHitboxScale(car, meshyBody);
	if (meshyBody) {
		const id = resolvedId;
		prepareEmptyWheelWellsBeforeGroundAlign(car, id);
		applyMeshyNoseYaw(car, id);
		bakeCarRootTransform(car);
		flattenCarContentToRoot(car);
		ensureBodyNormalsOutward(car);
		enforceBodyMaterialsFrontSide(car);
		centerCarOnHorizontalOrigin(car);
		finalizeMeshyNosePlusZ(car, id);
		centerCarOnHorizontalOrigin(car);
		repositionEmptyWheelHubsFromBody(car, id);
		} else {
			normalizeWheelRigs(car);
		}
		finalizeCarGroundAlign(car, meshyBody);
		prepareCarWheelWellsForLoad(car, resolvedId);
		/** Align końcowy w buildCarMesh / fitCarVisualToHitbox po kosmetykach. */
	/** Hex-chrome accents tylko na procedural Octane — nie na licensed paint. */
	if (!meshyBody) addTeamAccents(car, team);
	addCarSockets(car);
	sanitizeCarVisuals(car);
	}

	/** Ghost-hide tylko showcase/thumbnail — w meczu nie ukrywaj body (trans/mask). */

		const displayGroup = new THREE.Group();
		displayGroup.name = "octaneCarDisplay";
		const actualId =
			typeof car.userData.carId === "string" ? car.userData.carId : resolvedId;
		const loadFallbackFrom =
			typeof car.userData.loadFallbackFrom === "string"
				? car.userData.loadFallbackFrom
				: null;
		displayGroup.userData.carId = actualId;
		displayGroup.userData.requestedCarId = resolvedId;
		displayGroup.userData.licensedPreview = keepGlbMats;
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
	const keepGlbMats = isLicensedPreviewCar(resolvedId);

	const rubberMat = createTireRubberMaterial();

	const bodyMesh = car.getObjectByName("body");
	const meshyBody =
		!keepGlbMats &&
		bodyMesh instanceof THREE.Mesh &&
		car.getObjectByName("wheel_FL") != null;

	car.traverse((obj) => {
		obj.frustumCulled = false;
		if (!(obj instanceof THREE.Mesh)) return;
		obj.geometry?.computeBoundingSphere();
		if (keepGlbMats) return;
		const n = obj.name.toLowerCase();
		if (n.includes("_rim")) return;
		if (n.startsWith("wheel_") || (n.includes("wheel") && n !== "body")) {
			if (!n.includes("_rim")) obj.material = rubberMat;
			return;
		}
		if (obj.name === "body" && meshyBody) {
			enhanceMeshyBodyMaterial(obj, "blue", true);
		}
	});

	if (keepGlbMats) {
		fixLicensedTextureUvChannels(car);
		hardenLicensedBodyMaterials(car);
		retintLicensedChromaGlass(car);
		car.userData.licensedPreview = true;
		fitToHitboxScale(car, false, true);
		finalizeCarGroundAlign(car, false);
	} else {
	sanitizeCarVisuals(car);
	fitToHitboxScale(car, meshyBody);
	if (meshyBody) {
		prepareEmptyWheelWellsBeforeGroundAlign(car, resolvedId);
		applyMeshyNoseYaw(car, resolvedId);
		bakeCarRootTransform(car);
		flattenCarContentToRoot(car);
		ensureBodyNormalsOutward(car);
		enforceBodyMaterialsFrontSide(car);
		centerCarOnHorizontalOrigin(car);
		finalizeMeshyNosePlusZ(car, resolvedId);
		centerCarOnHorizontalOrigin(car);
		repositionEmptyWheelHubsFromBody(car, resolvedId);
	} else {
		normalizeWheelRigs(car);
	}
	finalizeCarGroundAlign(car, meshyBody);
	prepareCarWheelWellsForLoad(car, resolvedId);
	sanitizeCarVisuals(car);
	if (meshyBody) hideShowcaseGhostMeshes(car);
	/**
	 * Trellis bez felg w miniaturce — maskuj wbake'owane kule w nadkolach.
	 */
	if (carUsesEmptyWheelWells(resolvedId)) {
		applyBodyWheelWellMaskForEmptyHubs(car, resolvedId);
	}
	}
	fitCarVisualToHitbox(car);

	const displayGroup = new THREE.Group();
	displayGroup.name = "carThumbnailDisplay";
	displayGroup.userData.carId = resolvedId;
	displayGroup.userData.licensedPreview = keepGlbMats;
	displayGroup.add(car);
	return displayGroup;
}
	
export async function buildCarModel(
		carId: string = getDefaultCarId(),
		team: "blue" | "orange" = "blue",
	): Promise<THREE.Group> {
		return loadCarModel(carId, team);
	}
