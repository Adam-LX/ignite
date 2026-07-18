import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { getTopperEntry, getWheelEntry } from "../meta/CosmeticCatalog";
import { assetUrl } from "../util/assetUrl";
import { createGltfLoader } from "../util/gltfLoader";
import {
	alignWheelInstanceOnHub,
	clearHubForCosmeticMount,
	hideStockWheelMeshes,
	purgeStrayWheelMeshesFromCar,
	removeCosmeticRim,
	resolveCarIdFromVisual,
	resolveCarWheelDiameterM,
	resolveWheelItemReferenceDiameterM,
	suppressStockWheelVisuals,
	WHEEL_HUB_NAMES,
} from "./wheelMount";
import {
	clampBodyAboveWheelLine,
	raiseMeshesBelowWheelLine,
	snapCosmeticHubsToGround,
	visualLowestY,
	wheelContactMinY,
	wheelGroundTargetY,
} from "./carWheelGround";
import {
	applyBodyWheelWellMask,
} from "./bodyWheelWellMask";

const glbCache = new Map<string, THREE.Group>();
const GLB_CACHE_TAG = "proc-wheels-v17-preserve-contact";

/** Spłaszcza GLB felgi do jednego mesha (unika artefaktów multi-primitive). */
function flattenWheelGlb(root: THREE.Group): THREE.Group {
	const flat = new THREE.Group();
	root.updateMatrixWorld(true);
	const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
	const baked = new THREE.Matrix4();
	const geos: THREE.BufferGeometry[] = [];
	const materials: THREE.Material[] = [];
	root.traverse((child) => {
		if (!(child instanceof THREE.Mesh)) return;
		baked.copy(child.matrixWorld).premultiply(inv);
		const geo = child.geometry.clone();
		geo.applyMatrix4(baked);
		geos.push(geo);
		const mats = Array.isArray(child.material) ? child.material : [child.material];
		for (const mat of mats) {
			if (mat) materials.push(mat);
		}
	});
	if (geos.length === 0) return flat;
	const merged = mergeGeometries(geos, true);
	if (!merged) return flat;
	const mesh = new THREE.Mesh(merged, materials.length === 1 ? materials[0]! : materials);
	mesh.name = "wheel";
	flat.add(mesh);
	return flat;
}

export async function loadItemGlb(relativePath: string): Promise<THREE.Group> {
	const url = assetUrl(relativePath);
	const cacheKey = `${GLB_CACHE_TAG}:${url}`;
	const cached = glbCache.get(cacheKey);
	if (cached) return cached.clone(true);

	const loader = createGltfLoader();
	const gltf = await loader.loadAsync(url);
	const model = flattenWheelGlb(gltf.scene);
	model.name = `itemGlb_${relativePath}`;
	glbCache.set(cacheKey, model);
	return model.clone(true);
}

function findCarRoot(root: THREE.Object3D): THREE.Object3D {
	if (root.getObjectByName("octaneCar")) return root;
	let node: THREE.Object3D | null = root;
	while (node) {
		if (node.name === "octaneCar" || node.name === "octaneCarDisplay") return node;
		node = node.parent;
	}
	return root;
}

/** Po klonie auta — stock opony ukryte gdy GLB felgi zamontowane. */
export function reconcileMountedCosmeticWheels(root: THREE.Object3D): void {
	const car = findCarRoot(root);
	for (const hubName of WHEEL_HUB_NAMES) {
		const hub = car.getObjectByName(hubName);
		if (!hub?.getObjectByName(`cosmetic_rim_${hubName}`)) continue;
		hideStockWheelMeshes(hub);
	}
}

/**
 * Snap felg do *obecnej* linii styku auta (po alignCarToHitbox),
 * nie do absolutnego surfaceContactY — inaczej huby lądują na murawie,
 * a body zostaje pod nią (−hitboxHalfY).
 */
function snapMountedWheelsPreservingContact(car: THREE.Object3D): number {
	const preserveY =
		wheelContactMinY(car) ?? visualLowestY(car);
	const delta = snapCosmeticHubsToGround(car, preserveY);
	clampBodyAboveWheelLine(car);
	raiseMeshesBelowWheelLine(car);
	return delta;
}

function fitToTargetBox(
	model: THREE.Object3D,
	targetDiameter: number,
): void {
	model.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(model);
	const size = box.getSize(new THREE.Vector3());
	const maxDim = Math.max(size.x, size.y, size.z);
	if (maxDim < 1e-4) return;
	const scale = (targetDiameter / maxDim) * 0.92;
	model.scale.multiplyScalar(scale);
	model.updateMatrixWorld(true);
	const center = box.setFromObject(model).getCenter(new THREE.Vector3());
	model.position.sub(center);
}

/** Montuje GLB felgi na 4 hubach — skala po średnicy referencyjnej, nie bbox huba. */
export function snapCosmeticWheelsIfMounted(root: THREE.Object3D): boolean {
	const car = findCarRoot(root);
	if (!car.getObjectByName("cosmetic_rim_wheel_FL")) return false;
	const meshyBody =
		car.getObjectByName("body") != null &&
		car.getObjectByName("wheel_FL") != null;
	if (!meshyBody) return false;
	/** Showcase: snap do murawy; clampBody trzyma nadwozie nad kołami. */
	snapCosmeticHubsToGround(car, wheelGroundTargetY(car, true));
	clampBodyAboveWheelLine(car);
	raiseMeshesBelowWheelLine(car);
	applyBodyWheelWellMask(car);
	return true;
}

export async function mountWheelGlb(
	root: THREE.Object3D,
	wheelId: string,
	carId?: string | null,
): Promise<boolean> {
	const entry = getWheelEntry(wheelId);
	if (!entry?.glb) return false;

	let template: THREE.Group;
	try {
		template = await loadItemGlb(entry.glb);
	} catch {
		return false;
	}

	const resolvedCarId = carId ?? resolveCarIdFromVisual(root);
	const itemDiameterM = resolveWheelItemReferenceDiameterM(entry, template);
	const car = findCarRoot(root);
	let mounted = 0;

	for (const hubName of WHEEL_HUB_NAMES) {
		const hub = car.getObjectByName(hubName);
		if (!hub) continue;

		removeCosmeticRim(hub, hubName);
		clearHubForCosmeticMount(hub);

		const targetDiameterM = resolveCarWheelDiameterM(resolvedCarId, hubName);
		const rim = template.clone(true);
		rim.name = `cosmetic_rim_${hubName}`;
		alignWheelInstanceOnHub(rim, hub, targetDiameterM, itemDiameterM, "+X");
		mounted++;
	}

	if (mounted > 0) {
		purgeStrayWheelMeshesFromCar(car);
		suppressStockWheelVisuals(car);
		applyBodyWheelWellMask(car, resolvedCarId);
		const meshyBody =
			car.getObjectByName("body") != null &&
			car.getObjectByName("wheel_FL") != null;
		if (meshyBody) {
			car.userData.wheelSnapDelta = snapMountedWheelsPreservingContact(car);
		}
	}
	return mounted > 0;
}

/** Montuje GLB czapki na dachu auta. */
export async function mountTopperGlb(
	root: THREE.Object3D,
	topperId: string,
): Promise<boolean> {
	const entry = getTopperEntry(topperId);
	if (!entry?.glb) return false;

	let template: THREE.Group;
	try {
		template = await loadItemGlb(entry.glb);
	} catch {
		return false;
	}

	const car = findCarRoot(root);
	const body = car.getObjectByName("body") ?? car;
	body.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(body);
	const cx = (box.min.x + box.max.x) * 0.5;
	const cz = (box.min.z + box.max.z) * 0.5;
	const roofY = box.max.y;

	const topper = template.clone(true);
	topper.name = "cosmetic_topper_glb";
	fitToTargetBox(topper, 0.32);
	topper.position.set(cx, roofY + 0.04, cz);
	car.add(topper);
	return true;
}

export function clearCosmeticGlbCache(): void {
	glbCache.clear();
}
