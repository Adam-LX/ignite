import * as THREE from "three";

import {
	carUsesEmptyWheelWells,
	getCarEntry,
	resolveCarId,
	type CarBodyStyle,
} from "../meta/CarCatalog";
import { RL_CAR } from "../util/rlConstants";

const WHEEL_NAMES = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;

/** Lekki luz nad murawą — bez zapadania opon / z-fighting (nie unosić hitboxa). */
export const RIDE_CLEARANCE = 0.022;

/** Śmieć Trellis — drop poniżej huba większy niż to = artefakt, nie opona. */
const TRELLIS_BLOB_MAX_DROP_M = 0.45;

const DEFAULT_HUB_RADIUS_M = 0.125;

const BODY_STYLE_DIAMETERS: Record<
	CarBodyStyle,
	{ front: number; rear: number }
> = {
	standard: { front: 0.25, rear: 0.25 },
	wide: { front: 0.28, rear: 0.28 },
	low: { front: 0.24, rear: 0.24 },
	hatch: { front: 0.25, rear: 0.25 },
	tall: { front: 0.3, rear: 0.3 },
};

const _hubPos = new THREE.Vector3();
const _hubScale = new THREE.Vector3();
const _vertWorld = new THREE.Vector3();

function isFrontHub(name: string): boolean {
	return name === "wheel_FL" || name === "wheel_FR";
}

function wheelDiameterM(carId: string, hubName: string): number {
	const entry = getCarEntry(resolveCarId(carId));
	const style = entry?.bodyStyle ?? "standard";
	const defaults = BODY_STYLE_DIAMETERS[style] ?? BODY_STYLE_DIAMETERS.standard;
	const mounts = entry?.wheelMounts;
	const lateral = THREE.MathUtils.clamp(mounts?.lateralScale ?? 1, 0.85, 1.15);
	if (isFrontHub(hubName)) {
		return (mounts?.frontDiameterM ?? defaults.front) * lateral;
	}
	return (mounts?.rearDiameterM ?? defaults.rear) * lateral;
}

function resolveCarIdForRoot(root: THREE.Object3D): string {
	let node: THREE.Object3D | null = root;
	while (node) {
		const id = node.userData?.carId;
		if (typeof id === "string" && id.length > 0) return resolveCarId(id);
		node = node.parent;
	}
	return resolveCarId(null);
}

function hubWorldUniformScale(hub: THREE.Object3D): number {
	hub.getWorldScale(_hubScale);
	return Math.max(
		Math.abs(_hubScale.x),
		Math.abs(_hubScale.y),
		Math.abs(_hubScale.z),
		1e-4,
	);
}

function visibleWorldBounds(root: THREE.Object3D): THREE.Box3 | null {
	const box = new THREE.Box3();
	let found = false;
	root.traverse((node) => {
		if (!(node instanceof THREE.Mesh) || !node.visible) return;
		node.geometry?.computeBoundingBox();
		const gb = node.geometry?.boundingBox;
		if (!gb) return;
		box.union(gb.clone().applyMatrix4(node.matrixWorld));
		found = true;
	});
	return found && !box.isEmpty() ? box : null;
}

function visualLowestY(root: THREE.Object3D): number {
	root.updateMatrixWorld(true);
	return new THREE.Box3().setFromObject(root).min.y;
}

/**
 * Wbite opony Trellis w `body` — sample wierzchołków w cylindrze nadkola
 * (XZ wokół huba, Y poniżej środka huba).
 */
export function bodyArchBakeMinY(
	root: THREE.Object3D,
	carId?: string | null,
): number | null {
	const body = root.getObjectByName("body");
	if (!(body instanceof THREE.Mesh)) return null;
	const pos = body.geometry?.attributes?.position;
	if (!pos) return null;

	const id = carId ? resolveCarId(carId) : resolveCarIdForRoot(root);
	body.updateMatrixWorld(true);
	root.updateMatrixWorld(true);

	let minY = Infinity;
	let hits = 0;

	for (const hubName of WHEEL_NAMES) {
		const hub = root.getObjectByName(hubName);
		if (!hub) continue;
		hub.updateMatrixWorld(true);
		hub.getWorldPosition(_hubPos);
		const radius = wheelDiameterM(id, hubName) * 0.55;
		const r2 = radius * radius;

		for (let i = 0; i < pos.count; i++) {
			_vertWorld.fromBufferAttribute(pos, i).applyMatrix4(body.matrixWorld);
			if (_vertWorld.y > _hubPos.y + 0.02) continue;
			const dx = _vertWorld.x - _hubPos.x;
			const dz = _vertWorld.z - _hubPos.z;
			if (dx * dx + dz * dz > r2) continue;
			minY = Math.min(minY, _vertWorld.y);
			hits++;
		}
	}

	return hits >= 1 && Number.isFinite(minY) ? minY : null;
}

/**
 * Prawdziwe dno opony (cosmetic / stock AABB / bake w nadkolu).
 * Nigdy samotne hub−0.125 gdy jest mesh opony.
 */
export function measureTireContactMinY(root: THREE.Object3D): number | null {
	root.updateMatrixWorld(true);
	let minY = Infinity;
	let found = false;
	const carId = resolveCarIdForRoot(root);

	for (const name of WHEEL_NAMES) {
		const hub = root.getObjectByName(name);
		if (!hub) continue;
		hub.updateMatrixWorld(true);

		const cosmetic = hub.getObjectByName(`cosmetic_rim_${name}`);
		if (cosmetic) {
			const box = visibleWorldBounds(cosmetic);
			if (box) {
				minY = Math.min(minY, box.min.y);
				found = true;
				continue;
			}
		}

		hub.getWorldPosition(_hubPos);
		const hubY = _hubPos.y;
		const scale = hubWorldUniformScale(hub);

		let hasVisibleMesh = false;
		hub.traverse((n) => {
			if (n instanceof THREE.Mesh && n.visible) hasVisibleMesh = true;
		});

		if (hasVisibleMesh) {
			const stockBox = visibleWorldBounds(hub);
			if (stockBox) {
				const stockMin = stockBox.min.y;
				if (stockMin >= hubY - TRELLIS_BLOB_MAX_DROP_M) {
					minY = Math.min(minY, stockMin);
					found = true;
					continue;
				}
			}
		}

		const radiusWorld = wheelDiameterM(carId, name) * 0.5 * scale;
		minY = Math.min(
			minY,
			hubY - Math.max(radiusWorld, DEFAULT_HUB_RADIUS_M * scale),
		);
		found = true;
	}

	// Bake w nadkolu tylko gdy brak cosmetic rimów — inaczej zawyża kontakt
	// i unosi karoserię względem felg (koła „oderwane”).
	const hasCosmeticRim = WHEEL_NAMES.some(
		(n) => root.getObjectByName(n)?.getObjectByName(`cosmetic_rim_${n}`) != null,
	);
	if (!hasCosmeticRim && carUsesEmptyWheelWells(carId)) {
		const bake = bodyArchBakeMinY(root, carId);
		if (bake != null) {
			minY = Math.min(minY, bake);
			found = true;
		}
	}

	return found ? minY : null;
}

export function hitboxWheelContactLocalY(): number {
	return -RL_CAR.hitboxHalfY + RIDE_CLEARANCE;
}

/** Węzeł z align (inner model, nie display wrapper). */
export function hitboxAlignRoot(root: THREE.Object3D): THREE.Object3D {
	const named = root.getObjectByName("octaneCar");
	if (named) return named;
	if (root.name === "octaneCarDisplay" && root.children[0]) {
		return root.children[0]!;
	}
	return root;
}

/**
 * Podnosi spoiler/chrome poniżej linii opon.
 * WYŁĄCZONE — osobne `mesh.position.y +=` rozrywa Trellis na latające kawałki.
 */
export function raiseNonTireBelowContact(_root: THREE.Object3D): void {
	/* no-op */
}

/**
 * Jedyny align: dno opony = −hitboxHalfY + RIDE_CLEARANCE względem środka hitboxa.
 * Tylko offset całego inner root — bez ruszania poszczególnymi meshami.
 */
export function fitCarVisualToHitbox(root: THREE.Object3D): void {
	const inner = hitboxAlignRoot(root);
	inner.position.y = 0;
	inner.updateMatrixWorld(true);
	const ground = measureTireContactMinY(inner) ?? visualLowestY(inner);
	inner.position.y = hitboxWheelContactLocalY() - ground;
	inner.updateMatrixWorld(true);
}
