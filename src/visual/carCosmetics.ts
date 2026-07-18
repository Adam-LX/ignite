import * as THREE from "three";

import { carUsesEmptyWheelWells, resolveCarId, resolveWheelIdForCar } from "../meta/CarCatalog";
import type { CosmeticKind } from "../meta/CosmeticCatalog";
import {
	getDecalEntry,
	getTopperEntry,
	getWheelEntry,
} from "../meta/CosmeticCatalog";
import {
	getEquippedCosmetic,
	getCarBodyLoadout,
	getEquippedDecalId,
	getEquippedPaintId,
	getEquippedTopperId,
	getEquippedWheelId,
} from "../meta/PlayerInventory";
import {
	applyPaintToDecal,
	applyPaintToTopper,
	applyPaintToWheel,
} from "./applyPaintCosmetic";
import { mountTopperGlb, mountWheelGlb } from "./cosmeticGlb";
import {
	removeCosmeticRim,
	resolveCarIdFromVisual,
	restoreAllStockWheelVisuals,
} from "./wheelMount";
import { clearBodyWheelWellMask } from "./bodyWheelWellMask";

export type CarCosmeticLoadout = {
	wheelId?: string;
	topperId?: string;
	decalId?: string;
	paint: Partial<Record<CosmeticKind, string | null>>;
};

export function getEquippedCarLoadout(carId?: string | null): CarCosmeticLoadout {
	const id = resolveCarId(carId ?? getEquippedCosmetic("car").itemId);
	const body = getCarBodyLoadout(id);
	return {
		wheelId: resolveWheelIdForCar(id, body.wheel.itemId),
		topperId: body.topper.itemId,
		decalId: body.decal.itemId,
		paint: {
			car: getEquippedPaintId("car"),
			wheel: body.wheel.paintId,
			topper: body.topper.paintId,
			decal: body.decal.paintId,
		},
	};
}

const WHEEL_TINT: Record<string, number> = {
	steel: 0x8899aa,
	rally: 0xeeeeee,
	neon: 0x22ddff,
	chrome: 0xffffff,
};

const TOPPER_COLORS: Record<string, number> = {
	cap: 0xcc2222,
	antenna: 0x888888,
	halo: 0xffcc44,
	crown: 0xffd700,
};

function findCarRoot(root: THREE.Object3D): THREE.Object3D {
	if (root.getObjectByName("octaneCar")) return root;
	let node: THREE.Object3D | null = root;
	while (node) {
		if (node.name === "octaneCar" || node.name === "octaneCarDisplay") return node;
		node = node.parent;
	}
	return root;
}

function removeCosmeticGroup(root: THREE.Object3D, name: string): void {
	const car = findCarRoot(root);
	const existing = car.getObjectByName(name);
	if (existing) car.remove(existing);
}

function bodyMesh(root: THREE.Object3D): THREE.Mesh | null {
	const car = findCarRoot(root);
	const body = car.getObjectByName("body");
	return body instanceof THREE.Mesh ? body : null;
}

function bodyBox(root: THREE.Object3D): THREE.Box3 {
	const body = bodyMesh(root);
	if (!body) {
		const car = findCarRoot(root);
		return new THREE.Box3().setFromObject(car);
	}
	body.updateMatrixWorld(true);
	return new THREE.Box3().setFromObject(body);
}

/** Decal geometry overlay + emissive tint. */
export function applyDecalCosmetic(
	root: THREE.Object3D,
	decalId?: string,
	paintId?: string | null,
): void {
	const id = decalId ?? getEquippedDecalId();
	const paint = paintId ?? getEquippedPaintId("decal");
	removeCosmeticGroup(root, "cosmetic_decal");

	const entry = getDecalEntry(id);
	if (!entry || id === "default") return;

	if (entry.tint) {
		root.traverse((node) => {
			if (!(node instanceof THREE.Mesh)) return;
			if (!node.name.toLowerCase().includes("body")) return;
			const mats = Array.isArray(node.material) ? node.material : [node.material];
			for (const mat of mats) {
				if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
				mat.emissive.setRGB(entry.tint!.r, entry.tint!.g, entry.tint!.b);
				mat.emissiveIntensity = entry.emissive;
			}
		});
	}

	const box = bodyBox(root);
	const cx = (box.min.x + box.max.x) * 0.5;
	const cz = (box.min.z + box.max.z) * 0.5;
	const w = box.max.x - box.min.x;
	const l = box.max.z - box.min.z;
	const h = box.max.y - box.min.y;
	const group = new THREE.Group();
	group.name = "cosmetic_decal";

	const tintColor = entry.tint
		? new THREE.Color(entry.tint.r, entry.tint.g, entry.tint.b)
		: new THREE.Color(0xffffff);
	const mat = new THREE.MeshStandardMaterial({
		color: tintColor,
		emissive: tintColor.clone(),
		emissiveIntensity: entry.emissive * 2.5,
		transparent: true,
		opacity: id === "camo" ? 0.35 : 0.55,
		metalness: id === "cyber" ? 0.85 : 0.2,
		roughness: 0.4,
		side: THREE.DoubleSide,
		depthWrite: false,
	});

	if (id === "stripes" || id === "cyber") {
		const stripeW = w * 0.04;
		const stripeL = l * 0.55;
		const y = box.min.y + h * 0.42;
		for (const side of [-1, 1] as const) {
			const stripe = new THREE.Mesh(
				new THREE.BoxGeometry(stripeW, h * 0.08, stripeL),
				mat.clone(),
			);
			stripe.position.set(cx + side * (w * 0.38), y, cz);
			group.add(stripe);
		}
		if (id === "cyber") {
			const hood = new THREE.Mesh(
				new THREE.BoxGeometry(w * 0.22, h * 0.03, l * 0.12),
				mat.clone(),
			);
			hood.position.set(cx, box.max.y - h * 0.08, box.max.z - l * 0.12);
			group.add(hood);
		}
	} else if (id === "flame") {
		const flame = new THREE.Mesh(
			new THREE.ConeGeometry(w * 0.18, h * 0.22, 6),
			mat,
		);
		flame.rotation.x = Math.PI / 2;
		flame.position.set(cx - w * 0.22, box.min.y + h * 0.35, box.max.z - l * 0.08);
		group.add(flame);
		const flameR = flame.clone();
		flameR.position.x = cx + w * 0.22;
		group.add(flameR);
	} else if (id === "camo") {
		const patch = new THREE.Mesh(
			new THREE.PlaneGeometry(w * 0.7, h * 0.35),
			mat,
		);
		patch.position.set(cx, box.min.y + h * 0.45, cz);
		patch.rotation.y = Math.PI / 2;
		group.add(patch);
	}

	findCarRoot(root).add(group);
	applyPaintToDecal(root, id, paint);
}

/** Tint kół — fallback gdy brak GLB. */
export function applyWheelCosmetic(
	root: THREE.Object3D,
	wheelId?: string,
	paintId?: string | null,
): void {
	const id = wheelId ?? getEquippedWheelId();
	if (id === "default") return;
	const entry = getWheelEntry(id);
	if (entry?.glb) return;

	const tint = WHEEL_TINT[id] ?? 0xcccccc;
	root.traverse((node) => {
		const n = node.name.toLowerCase();
		if (!n.includes("wheel") && !n.includes("rim")) return;
		if (!(node instanceof THREE.Mesh)) return;
		const mats = Array.isArray(node.material) ? node.material : [node.material];
		for (const mat of mats) {
			if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
			mat.emissive.setHex(tint);
			mat.emissiveIntensity =
				id === "neon" ? 0.85 : id === "chrome" ? 0.35 : 0.12;
			mat.metalness = id === "chrome" ? 0.95 : 0.55;
		}
	});
	applyPaintToWheel(root, id, paintId ?? getEquippedPaintId("wheel"));
}

/** Placeholder topper — gdy brak GLB. */
export function applyTopperCosmetic(
	root: THREE.Object3D,
	topperId?: string,
	paintId?: string | null,
): void {
	const id = topperId ?? getEquippedTopperId();
	removeCosmeticGroup(root, "cosmetic_topper");
	if (id === "default") return;

	const entry = getTopperEntry(id);
	if (entry?.glb) return;

	const color = TOPPER_COLORS[id] ?? 0xff8844;
	const group = new THREE.Group();
	group.name = "cosmetic_topper";
	const roofY = bodyBox(root).max.y + 0.04;
	const cx = bodyBox(root).getCenter(new THREE.Vector3()).x;
	const cz = bodyBox(root).getCenter(new THREE.Vector3()).z;

	let mesh: THREE.Mesh;
	if (id === "halo") {
		mesh = new THREE.Mesh(
			new THREE.TorusGeometry(0.28, 0.04, 8, 24),
			new THREE.MeshStandardMaterial({
				color,
				emissive: color,
				emissiveIntensity: 1.2,
				metalness: 0.9,
				roughness: 0.15,
			}),
		);
		mesh.rotation.x = Math.PI / 2;
		mesh.position.set(cx, roofY + 0.15, cz);
	} else if (id === "crown") {
		mesh = new THREE.Mesh(
			new THREE.ConeGeometry(0.22, 0.28, 5),
			new THREE.MeshStandardMaterial({
				color,
				emissive: color,
				emissiveIntensity: 0.65,
				metalness: 0.85,
				roughness: 0.25,
			}),
		);
		mesh.position.set(cx, roofY + 0.18, cz);
	} else if (id === "antenna") {
		mesh = new THREE.Mesh(
			new THREE.SphereGeometry(0.08, 8, 8),
			new THREE.MeshStandardMaterial({
				color: 0x44ff44,
				emissive: 0x22aa22,
				emissiveIntensity: 0.8,
			}),
		);
		mesh.position.set(cx, roofY + 0.35, cz);
	} else {
		mesh = new THREE.Mesh(
			new THREE.BoxGeometry(0.35, 0.12, 0.35),
			new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
		);
		mesh.position.set(cx, roofY, cz);
	}

	group.add(mesh);
	findCarRoot(root).add(group);
	applyPaintToTopper(root, id, paintId ?? getEquippedPaintId("topper"));
}

/** Pełny loadout: decal + wheel GLB/tint + topper GLB/placeholder + paint. */
export async function applyAllCarCosmetics(
	root: THREE.Object3D,
	loadout: CarCosmeticLoadout = getEquippedCarLoadout(),
	carId?: string | null,
): Promise<void> {
	const wheelId = loadout.wheelId ?? "default";
	const topperId = loadout.topperId ?? "default";
	const decalId = loadout.decalId ?? "default";

	removeCosmeticGroup(root, "cosmetic_topper_glb");
	clearBodyWheelWellMask(root);
	for (const hub of ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]) {
		const car = findCarRoot(root);
		const h = car.getObjectByName(hub);
		if (h) removeCosmeticRim(h, hub);
	}

	applyDecalCosmetic(root, decalId, loadout.paint.decal);

	const resolvedId = resolveCarId(carId ?? resolveCarIdFromVisual(root) ?? "");
	const usesEmptyWells = carUsesEmptyWheelWells(resolvedId);

	if (!usesEmptyWells && wheelId === "default") {
		clearBodyWheelWellMask(root);
		for (const hub of ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]) {
			const car = findCarRoot(root);
			const h = car.getObjectByName(hub);
			if (h) removeCosmeticRim(h, hub);
		}
		restoreAllStockWheelVisuals(findCarRoot(root));
	} else {
		const wheelGlb = await mountWheelGlb(root, wheelId, carId);
		if (!wheelGlb) {
			clearBodyWheelWellMask(root);
			restoreAllStockWheelVisuals(findCarRoot(root));
			applyWheelCosmetic(root, wheelId, loadout.paint.wheel);
		} else {
			applyPaintToWheel(root, wheelId, loadout.paint.wheel);
		}
	}

	const topperGlb = await mountTopperGlb(root, topperId);
	if (!topperGlb) {
		applyTopperCosmetic(root, topperId, loadout.paint.topper);
	} else {
		applyPaintToTopper(root, topperId, loadout.paint.topper);
	}
}
