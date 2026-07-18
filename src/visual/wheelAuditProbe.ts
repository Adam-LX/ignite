import * as THREE from "three";

import { getEquippedCarLoadout } from "./carCosmetics";
import { resolveWheelIdForCar } from "../meta/CarCatalog";
import { WHEEL_HUB_NAMES } from "./wheelMount";

export type WheelAuditProbe = {
	carId: string | null;
	wheelId: string | null;
	bodyMeshes: number;
	hubCount: number;
	cosmeticRims: number;
	strayWheelMeshes: number;
	visibleWheelNamedMeshes: number;
	menuHeroPresent: boolean;
	rimFlWorldY: number | null;
	rimFlGeomMinWorldY: number | null;
	rimFlGeomMaxWorldY: number | null;
	wheelSnapDelta: number | null;
	bodyMinWorldY: number | null;
};

const WHEEL_MESH_RX = /wheel|tire|tyre|rim|opon|tread|cylinder/i;

function isLikelyStrayWheel(mesh: THREE.Mesh): boolean {
	if (mesh.name === "body") return false;
	const n = mesh.name.toLowerCase();
	if (n.startsWith("cosmetic_rim_")) return false;
	if (WHEEL_MESH_RX.test(n)) return true;
	mesh.geometry?.computeBoundingBox();
	const box = mesh.geometry?.boundingBox;
	if (!box) return false;
	const size = new THREE.Vector3();
	box.getSize(size);
	const dims = [size.x, size.y, size.z].sort((a, b) => a - b) as [
		number,
		number,
		number,
	];
	if (dims[0] < 1e-4) return false;
	return dims[2] / dims[0] > 2.2 && dims[2] > 0.06 && dims[2] < 0.65;
}

function isUnderCosmeticRim(node: THREE.Object3D): boolean {
	let p: THREE.Object3D | null = node;
	while (p) {
		if (p.name.startsWith("cosmetic_rim_")) return true;
		p = p.parent;
	}
	return false;
}

export function probeWheelAuditScene(
	scene: THREE.Scene,
	carId: string | null,
	wheelId: string | null,
): WheelAuditProbe {
	let bodyMeshes = 0;
	let hubCount = 0;
	let cosmeticRims = 0;
	let strayWheelMeshes = 0;
	let visibleWheelNamedMeshes = 0;
	let menuHeroPresent = false;

	const hero = scene.getObjectByName("menuHeroCar");
	if (!hero) {
		return {
			carId,
			wheelId,
			bodyMeshes,
			hubCount,
			cosmeticRims,
			strayWheelMeshes,
			visibleWheelNamedMeshes,
			menuHeroPresent,
			rimFlWorldY: null,
			rimFlGeomMinWorldY: null,
			rimFlGeomMaxWorldY: null,
			wheelSnapDelta: null,
			bodyMinWorldY: null,
		};
	}
	menuHeroPresent = true;

	let rimFlWorldY: number | null = null;
	let rimFlGeomMinWorldY: number | null = null;
	let rimFlGeomMaxWorldY: number | null = null;
	let wheelSnapDelta: number | null = null;
	let bodyMinWorldY: number | null = null;
	const _p = new THREE.Vector3();
	const _box = new THREE.Box3();

	hero.traverse((node) => {
		if (
			node.name === "octaneCarDisplay" ||
			node.name === "octaneCar" ||
			node.name.endsWith("Car_blue") ||
			node.name.endsWith("Car_orange") ||
			node.name === "car"
		) {
			const delta = node.userData?.wheelSnapDelta;
			if (typeof delta === "number") wheelSnapDelta = delta;
		}
		if (WHEEL_HUB_NAMES.includes(node.name as (typeof WHEEL_HUB_NAMES)[number])) {
			hubCount++;
		}
		if (node.name.startsWith("cosmetic_rim_")) cosmeticRims++;
		if (node.name === "cosmetic_rim_wheel_FL") {
			node.getWorldPosition(_p);
			rimFlWorldY = _p.y;
			node.updateMatrixWorld(true);
			_box.setFromObject(node);
			rimFlGeomMinWorldY = _box.min.y;
			rimFlGeomMaxWorldY = _box.max.y;
		}
		if (!(node instanceof THREE.Mesh) || !node.visible) return;
		if (node.name === "body") {
			bodyMeshes++;
			node.updateMatrixWorld(true);
			_box.setFromObject(node);
			bodyMinWorldY = _box.min.y;
			return;
		}
		if (isUnderCosmeticRim(node)) return;
		if (WHEEL_MESH_RX.test(node.name)) visibleWheelNamedMeshes++;
		if (isLikelyStrayWheel(node)) strayWheelMeshes++;
	});

	return {
		carId,
		wheelId,
		bodyMeshes,
		hubCount,
		cosmeticRims,
		strayWheelMeshes,
		visibleWheelNamedMeshes,
		menuHeroPresent,
		rimFlWorldY,
		rimFlGeomMinWorldY,
		rimFlGeomMaxWorldY,
		wheelSnapDelta,
		bodyMinWorldY,
	};
}

export type WheelAuditMeshSample = {
	name: string;
	parent: string;
	worldX: number;
	worldMinY: number;
	worldMaxY: number;
	worldZ: number;
	visible: boolean;
};

/** Diagnostyka — widoczne meshe w hero z dużym Y (pływające koła). */
export function sampleHeroWheelMeshes(scene: THREE.Scene): WheelAuditMeshSample[] {
	const hero = scene.getObjectByName("menuHeroCar");
	if (!hero) return [];
	const out: WheelAuditMeshSample[] = [];
	const box = new THREE.Box3();
	const center = new THREE.Vector3();
	hero.traverse((node) => {
		if (!(node instanceof THREE.Mesh) || !node.visible) return;
		node.updateMatrixWorld(true);
		box.setFromObject(node);
		if (box.isEmpty()) return;
		box.getCenter(center);
		out.push({
			name: node.name,
			parent: node.parent?.name ?? "",
			worldX: center.x,
			worldMinY: box.min.y,
			worldMaxY: box.max.y,
			worldZ: center.z,
			visible: node.visible,
		});
	});
	return out.sort((a, b) => b.worldMaxY - a.worldMaxY);
}

export function buildGarageAuditLoadout(carId: string, wheelId: string) {
	const normalizedWheel =
		wheelId === "factory" || wheelId === "default"
			? resolveWheelIdForCar(carId, "default")
			: wheelId;
	const base = getEquippedCarLoadout(carId);
	return {
		...base,
		wheelId: normalizedWheel,
		paint: { ...base.paint, wheel: null },
	};
}
