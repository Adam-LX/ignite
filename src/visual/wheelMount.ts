import * as THREE from "three";

import {
	getCarEntry,
	resolveCarId,
	type CarBodyStyle,
	type CarWheelMounts,
} from "../meta/CarCatalog";
import type { WheelCatalogEntry } from "../meta/CosmeticCatalog";
import { visibleWorldBounds, bodyGroundLocalY } from "./carWheelGround";
import { wheelTrackHalfWidth } from "./octaneCarMesh";

export { bodyGroundLocalY } from "./carWheelGround";

export const WHEEL_HUB_NAMES = [
	"wheel_FL",
	"wheel_FR",
	"wheel_RL",
	"wheel_RR",
] as const;

export type WheelHubName = (typeof WHEEL_HUB_NAMES)[number];

const FRONT_HUBS = new Set<WheelHubName>(["wheel_FL", "wheel_FR"]);

/** Domyślny promień opony przy pustych nadkolach (metry). */
export const DEFAULT_WHEEL_RADIUS_M = 0.125;

const BODY_STYLE_DIAMETERS: Record<
	CarBodyStyle,
	{ frontDiameterM: number; rearDiameterM: number }
> = {
	standard: { frontDiameterM: 0.25, rearDiameterM: 0.25 },
	wide: { frontDiameterM: 0.28, rearDiameterM: 0.28 },
	low: { frontDiameterM: 0.24, rearDiameterM: 0.24 },
	hatch: { frontDiameterM: 0.25, rearDiameterM: 0.25 },
	tall: { frontDiameterM: 0.3, rearDiameterM: 0.3 },
};

const _alignWorld = new THREE.Vector3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _invRoot = new THREE.Matrix4();
const _localMat = new THREE.Matrix4();

export function isFrontWheelHub(hubName: string): boolean {
	return FRONT_HUBS.has(hubName as WheelHubName);
}

/** Średnica montażu na aucie (metry) — katalog lub domyślne per bodyStyle. */
export function resolveCarWheelDiameterM(
	carId: string | undefined | null,
	hubName: string,
): number {
	const entry = carId ? getCarEntry(resolveCarId(carId)) : undefined;
	const mounts: CarWheelMounts | undefined = entry?.wheelMounts;
	const style = entry?.bodyStyle ?? "standard";
	const defaults =
		BODY_STYLE_DIAMETERS[style] ?? BODY_STYLE_DIAMETERS.standard;
	const lateral = THREE.MathUtils.clamp(mounts?.lateralScale ?? 1, 0.85, 1.15);

	if (isFrontWheelHub(hubName)) {
		return (mounts?.frontDiameterM ?? defaults.frontDiameterM) * lateral;
	}
	return (mounts?.rearDiameterM ?? defaults.rearDiameterM) * lateral;
}

/** Oś obrotu w hubie = lokalne X. Próbuje obrotów i wybiera układ „tarcza w YZ”. */
export function orientWheelInstanceForHub(
	instance: THREE.Object3D,
	axis: "+X" | "auto" = "auto",
): void {
	instance.rotation.set(0, 0, 0);
	instance.scale.set(1, 1, 1);
	instance.updateMatrixWorld(true);

	if (axis === "+X") {
		const size = new THREE.Box3().setFromObject(instance).getSize(_size);
		const thinX =
			size.x <= size.y &&
			size.x <= size.z &&
			size.x < Math.min(size.y, size.z) * 0.72;
		if (thinX) return;
		axis = "auto";
	}

	const baseSize = new THREE.Box3().setFromObject(instance).getSize(_size);
	if (
		baseSize.x <= baseSize.y &&
		baseSize.x <= baseSize.z &&
		baseSize.x < Math.min(baseSize.y, baseSize.z) * 0.72
	) {
		return;
	}

	const candidates = [
		new THREE.Euler(0, 0, 0),
		new THREE.Euler(0, 0, Math.PI / 2),
		new THREE.Euler(Math.PI / 2, 0, 0),
		new THREE.Euler(0, Math.PI / 2, 0),
	];

	let best = candidates[0]!;
	let bestScore = -Infinity;

	for (const euler of candidates) {
		instance.rotation.copy(euler);
		instance.updateMatrixWorld(true);
		const size = new THREE.Box3().setFromObject(instance).getSize(_size);
		const yz = Math.max(size.y, size.z);
		const score =
			yz / Math.max(size.x, 0.02) - Math.abs(size.y - size.z) * 0.35;
		if (score > bestScore + 1e-4) {
			bestScore = score;
			best = euler;
		}
	}

	instance.rotation.copy(best);
	instance.updateMatrixWorld(true);
}

/** Średnica referencyjna GLB felgi przy scale=1 (tarcza w płaszczyźnie YZ, oś X). */
export function measureWheelItemDiameterM(model: THREE.Object3D): number {
	const probe = model.clone(true);
	orientWheelInstanceForHub(probe);
	probe.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(probe);
	box.getSize(_size);
	disposeObject3D(probe);
	return Math.max(_size.y, _size.z, 0.04);
}

export function resolveWheelItemReferenceDiameterM(
	entry: WheelCatalogEntry,
	template: THREE.Object3D,
): number {
	if (entry.referenceDiameterM && entry.referenceDiameterM > 0.04) {
		return entry.referenceDiameterM;
	}
	return measureWheelItemDiameterM(template);
}

export function resolveCarIdFromVisual(root: THREE.Object3D): string | null {
	let node: THREE.Object3D | null = root;
	while (node) {
		const id = node.userData?.carId;
		if (typeof id === "string" && id.length > 0) return id;
		node = node.parent;
	}
	return null;
}

function setSubtreeVisible(root: THREE.Object3D, visible: boolean): void {
	root.traverse((node) => {
		node.visible = visible;
	});
}

/** Ukrywa stock opony w hubie — zostają do przywrócenia przy wheel=default. */
export function hideStockWheelMeshes(hub: THREE.Object3D): void {
	for (const child of hub.children) {
		if (child.name.startsWith("cosmetic_rim_")) continue;
		setSubtreeVisible(child, false);
	}
}

/** Przywraca stock po zdjęciu felgi kosmetycznej. */
export function restoreStockWheelMeshes(hub: THREE.Object3D): void {
	for (const child of hub.children) {
		if (child.name.startsWith("cosmetic_rim_")) continue;
		setSubtreeVisible(child, true);
	}
}

export function removeCosmeticRim(hub: THREE.Object3D, hubName: string): void {
	const rim = hub.getObjectByName(`cosmetic_rim_${hubName}`);
	if (!rim) return;
	hub.remove(rim);
	disposeObject3D(rim);
	const hasStock = hub.children.some(
		(child) => !child.name.startsWith("cosmetic_rim_"),
	);
	if (hasStock) restoreStockWheelMeshes(hub);
}

function disposeObject3D(obj: THREE.Object3D): void {
	obj.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) return;
		node.geometry?.dispose();
		const mats = Array.isArray(node.material) ? node.material : [node.material];
		for (const mat of mats) mat?.dispose();
	});
}

/** Usuwa opony z GLB auta — tylko dla karoserii z wheelWellMode=empty. */
export function clearHubForCosmeticMount(hub: THREE.Object3D): void {
	const toRemove = [...hub.children].filter(
		(child) => !child.name.startsWith("cosmetic_rim_"),
	);
	for (const child of toRemove) {
		hub.remove(child);
		disposeObject3D(child);
	}
}

export function stripStockWheelMeshesFromCar(car: THREE.Object3D): void {
	for (const hubName of WHEEL_HUB_NAMES) {
		const hub = car.getObjectByName(hubName);
		if (!hub) continue;
		clearHubForCosmeticMount(hub);
	}
}

function isLikelyWheelMesh(mesh: THREE.Mesh): boolean {
	const n = mesh.name.toLowerCase();
	if (n === "body") return false;
	if (WHEEL_MESH_NAME.test(n)) return true;

	mesh.geometry?.computeBoundingBox();
	const box = mesh.geometry?.boundingBox;
	if (!box) return false;
	box.getSize(_size);
	const dims = [_size.x, _size.y, _size.z].sort((a, b) => a - b) as [
		number,
		number,
		number,
	];
	if (dims[0] < 1e-4) return false;
	const aspect = dims[2] / dims[0];
	return aspect > 2.2 && dims[2] > 0.06 && dims[2] < 0.55;
}

/** Usuwa z GLB „wiszące” koła (Trellis/Blender) poza hubami kosmetycznymi. */
export function purgeStrayWheelMeshesFromCar(car: THREE.Object3D): void {
	const toRemove: THREE.Object3D[] = [];
	car.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) return;
		if (isUnderCosmeticRim(node)) return;
		if (node.name === "body") return;
		const hubAncestor = findAncestorHub(node, car);
		if (hubAncestor?.getObjectByName(`cosmetic_rim_${hubAncestor.name}`)) {
			return;
		}
		if (!isLikelyWheelMesh(node)) return;
		toRemove.push(node);
	});
	for (const node of toRemove) {
		node.removeFromParent();
		disposeObject3D(node);
	}
}

function findAncestorHub(
	node: THREE.Object3D,
	car: THREE.Object3D,
): THREE.Object3D | null {
	let p: THREE.Object3D | null = node.parent;
	while (p && p !== car) {
		if (WHEEL_HUB_NAMES.includes(p.name as WheelHubName)) return p;
		p = p.parent;
	}
	return null;
}

/** Ustawia puste huby z bbox nadwozia — pozycje WORLD → local (działa przy root.rotation.x ±90°). */
export function repositionEmptyWheelHubsFromBody(
	car: THREE.Object3D,
	carId?: string | null,
): void {
	const body = car.getObjectByName("body");
	if (!(body instanceof THREE.Mesh)) return;

	const resolvedId =
		carId ?? resolveCarIdFromVisual(car) ?? resolveCarId("octane");

	body.updateMatrixWorld(true);
	car.updateMatrixWorld(true);
	const bodyBox = new THREE.Box3().setFromObject(body);
	const cx = (bodyBox.min.x + bodyBox.max.x) * 0.5;
	const cz = (bodyBox.min.z + bodyBox.max.z) * 0.5;
	const length = bodyBox.max.z - bodyBox.min.z;
	const width = bodyBox.max.x - bodyBox.min.x;
	const groundY = bodyBox.min.y;
	const zFront = cz + length * 0.3;
	const zRear = cz - length * 0.28;
	const wx = wheelTrackHalfWidth(width);
	const frontRadius = resolveCarWheelDiameterM(resolvedId, "wheel_FL") * 0.5;
	const rearRadius = resolveCarWheelDiameterM(resolvedId, "wheel_RR") * 0.5;

	const worldTargets: Record<WheelHubName, THREE.Vector3> = {
		wheel_FL: new THREE.Vector3(cx - wx, groundY + frontRadius, zFront),
		wheel_FR: new THREE.Vector3(cx + wx, groundY + frontRadius, zFront),
		wheel_RL: new THREE.Vector3(cx - wx, groundY + rearRadius, zRear),
		wheel_RR: new THREE.Vector3(cx + wx, groundY + rearRadius, zRear),
	};

	const local = new THREE.Vector3();
	for (const hubName of WHEEL_HUB_NAMES) {
		let hub = car.getObjectByName(hubName);
		if (!hub) {
			hub = new THREE.Object3D();
			hub.name = hubName;
			car.add(hub);
		} else if (hub.parent !== car) {
			car.attach(hub);
		}
		local.copy(worldTargets[hubName]);
		car.worldToLocal(local);
		hub.position.copy(local);
		hub.rotation.set(0, 0, 0);
		hub.scale.set(1, 1, 1);
	}
}

/** Przed finalizeCarGroundAlign — purge, strip, huby z bbox body (po axes). */
export function prepareEmptyWheelWellsBeforeGroundAlign(
	car: THREE.Object3D,
	carId: string,
): void {
	const entry = getCarEntry(resolveCarId(carId));
	if (entry?.wheelWellMode !== "empty") return;

	purgeStrayWheelMeshesFromCar(car);
	stripStockWheelMeshesFromCar(car);

	/**
	 * Po ensureMeshyGltfAxes (±90° X) długość w hubach Blendera siedzi w local Y.
	 * syncEmptyWheelHubCenterY nadpisuje Y → FL/RL lądują w tym samym miejscu.
	 * Zawsze stawiamy huby z bbox nadwozia w układzie po axes.
	 */
	repositionEmptyWheelHubsFromBody(car, carId);
}

/** Blender: ground + 0.125 m — katalog ma per-auto promień; koryguje tylko Y huba. */
export function syncEmptyWheelHubCenterY(
	car: THREE.Object3D,
	carId: string,
): void {
	const body = car.getObjectByName("body");
	if (!(body instanceof THREE.Mesh)) return;

	body.updateMatrixWorld(true);
	car.updateMatrixWorld(true);
	const groundLocalY = bodyGroundLocalY(body, car);

	for (const hubName of WHEEL_HUB_NAMES) {
		const hub = car.getObjectByName(hubName);
		if (!hub) continue;
		const radius = resolveCarWheelDiameterM(carId, hubName) * 0.5;
		hub.position.y = groundLocalY + radius;
	}
}

/** Po finalize — ukrywa resztki stockowych kół w meshu. */
export function prepareCarWheelWellsForLoad(
	car: THREE.Object3D,
	carId: string,
): void {
	const entry = getCarEntry(resolveCarId(carId));
	if (entry?.wheelWellMode === "empty") {
		suppressStockWheelVisuals(car);
	}
}

const WHEEL_MESH_NAME =
	/wheel|tire|tyre|rim|opon|tread|opona/i;

function isUnderCosmeticRim(node: THREE.Object3D): boolean {
	let p: THREE.Object3D | null = node;
	while (p) {
		if (p.name.startsWith("cosmetic_rim_")) return true;
		p = p.parent;
	}
	return false;
}

/** Ukrywa stock opony poza kosmetycznym rimem (np. zduplikowane meshe w GLB). */
export function suppressStockWheelVisuals(car: THREE.Object3D): void {
	car.traverse((node) => {
		if (isUnderCosmeticRim(node)) return;
		if (node instanceof THREE.Mesh) {
			const n = node.name.toLowerCase();
			if (n === "body") return;
			if (WHEEL_MESH_NAME.test(n) || isLikelyWheelMesh(node)) {
				node.visible = false;
				node.userData.isStockWheel = true;
			}
			return;
		}
		if (WHEEL_HUB_NAMES.includes(node.name as WheelHubName)) {
			hideStockWheelMeshes(node);
		}
	});
}

/** Przywraca widoczność stockowych kół (wheel=default). */
export function restoreAllStockWheelVisuals(car: THREE.Object3D): void {
	for (const hubName of WHEEL_HUB_NAMES) {
		const hub = car.getObjectByName(hubName);
		if (hub) restoreStockWheelMeshes(hub);
	}
	car.traverse((node) => {
		if (isUnderCosmeticRim(node)) return;
		const n = node.name.toLowerCase();
		if (WHEEL_MESH_NAME.test(n)) {
			node.visible = true;
		}
	});
}

/** Środek geometrii w lokalnym układzie instancji — przesuwa dzieci, nie kumuluje offsetu na root. */
function centerInstanceGeometry(instance: THREE.Object3D): void {
	instance.position.set(0, 0, 0);
	instance.updateMatrixWorld(true);
	_invRoot.copy(instance.matrixWorld).invert();
	const box = new THREE.Box3();
	const chunk = new THREE.Box3();
	let found = false;
	instance.traverse((child) => {
		if (!(child instanceof THREE.Mesh)) return;
		child.geometry.computeBoundingBox();
		const gb = child.geometry.boundingBox;
		if (!gb) return;
		_localMat.copy(child.matrixWorld).premultiply(_invRoot);
		chunk.copy(gb).applyMatrix4(_localMat);
		box.union(chunk);
		found = true;
	});
	if (!found) return;
	box.getCenter(_center);
	for (const child of instance.children) {
		child.position.sub(_center);
	}
}

/** Skaluje i centruje instancję felgi w lokalnym układzie huba. */
export function alignWheelInstanceOnHub(
	instance: THREE.Object3D,
	hub: THREE.Object3D,
	targetDiameterM: number,
	itemReferenceDiameterM: number,
	wheelAxis: "+X" | "auto" = "auto",
): void {
	instance.position.set(0, 0, 0);
	instance.rotation.set(0, 0, 0);
	instance.scale.set(1, 1, 1);
	orientWheelInstanceForHub(instance, wheelAxis);
	centerInstanceGeometry(instance);

	if (instance.parent !== hub) {
		hub.add(instance);
	}

	const scale = targetDiameterM / Math.max(itemReferenceDiameterM, 0.04);
	instance.scale.setScalar(scale);
	/**
	 * Hub jest już na groundY+radius — felga musi zostać w origin huba.
	 * World-snap do murawy / hub.y dawał ogromny local offset przy zagnieżdżonym
	 * parent transform → „koła” kręcące się nad dachem.
	 */
	instance.position.set(0, 0, 0);
}

/** Wyrównuje dno opony do linii styku huba (nie absolutnej murawy). */
export function alignWheelContactToHub(
	instance: THREE.Object3D,
	hub: THREE.Object3D,
	targetRadiusM: number,
): void {
	hub.updateMatrixWorld(true);
	instance.updateMatrixWorld(true);
	const box = visibleWorldBounds(instance);
	if (!box) return;
	hub.getWorldPosition(_alignWorld);
	const targetMinY = _alignWorld.y - Math.max(targetRadiusM, 0.04);
	const deltaWorld = targetMinY - box.min.y;
	if (Math.abs(deltaWorld) < 1e-5) return;
	instance.getWorldPosition(_alignWorld);
	_alignWorld.y += deltaWorld;
	if (instance.parent) {
		instance.parent.worldToLocal(_alignWorld);
	}
	instance.position.copy(_alignWorld);
}
