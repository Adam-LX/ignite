import * as THREE from "three";

import type { PowerUpKind } from "../modes/IgnitionManager";
import { assetUrl } from "../util/assetUrl";
import { createGltfLoader } from "../util/gltfLoader";
import { POWER_UP_COLORS } from "./powerUpVisuals";

const PICKUP_TARGET_SIZE = 0.42;
const ROOF_Y_FALLBACK = 0.52;
const ROOF_LIFT = 0.06;

const roofAnchorScratch = new THREE.Box3();
const roofLocalScratch = new THREE.Vector3();

function resolveRoofLocalY(parent: THREE.Object3D): number {
	const body = parent.getObjectByName("body");
	if (!body) return ROOF_Y_FALLBACK;

	parent.updateMatrixWorld(true);
	roofAnchorScratch.setFromObject(body);
	roofLocalScratch.copy(roofAnchorScratch.max);
	parent.worldToLocal(roofLocalScratch);
	return roofLocalScratch.y + ROOF_LIFT;
}

const PICKUP_URL: Record<PowerUpKind, string> = {
	magnet: assetUrl("/assets/models/powerup_magnet.glb"),
	plunger: assetUrl("/assets/models/powerup_plunger.glb"),
	haymaker: assetUrl("/assets/models/powerup_haymaker.glb"),
	spikes: assetUrl("/assets/models/powerup_spikes.glb"),
};

const templateCache = new Map<PowerUpKind, THREE.Group>();
const loadPromises = new Map<PowerUpKind, Promise<THREE.Group>>();
const pickupMaterialCache = new Map<PowerUpKind, THREE.MeshStandardMaterial>();

function pickupMaterial(kind: PowerUpKind): THREE.MeshStandardMaterial {
	let mat = pickupMaterialCache.get(kind);
	if (!mat) {
		const hex = POWER_UP_COLORS[kind].three;
		mat = new THREE.MeshStandardMaterial({
			color: hex,
			emissive: new THREE.Color(hex),
			emissiveIntensity: 0.55,
			metalness: 0.35,
			roughness: 0.28,
		});
		pickupMaterialCache.set(kind, mat);
	}
	return mat;
}

/** Proceduralny pickup gdy brak GLB Meshy — kolory jak HUD (Gemini + Cursor). */
export function createProceduralPowerUpPickup(kind: PowerUpKind): THREE.Group {
	const group = new THREE.Group();
	group.name = `powerUpPickup_${kind}_procedural`;
	group.userData.proceduralFallback = true;

	const mat = pickupMaterial(kind);

	switch (kind) {
		case "magnet": {
			const arc = new THREE.Mesh(
				new THREE.TorusGeometry(0.2, 0.06, 12, 24, Math.PI * 1.35),
				mat,
			);
			arc.rotation.x = Math.PI / 2;
			group.add(arc);
			const poleMat = pickupMaterial(kind);
			poleMat.color.setHex(0xff5566);
			poleMat.emissive.setHex(0xff5566);
			for (const x of [-0.18, 0.18]) {
				const pole = new THREE.Mesh(
					new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10),
					poleMat,
				);
				pole.position.set(x, 0.08, 0);
				group.add(pole);
			}
			break;
		}
		case "plunger": {
			const cup = new THREE.Mesh(
				new THREE.CylinderGeometry(0.16, 0.14, 0.14, 16),
				mat,
			);
			cup.position.y = 0.07;
			group.add(cup);
			const handle = new THREE.Mesh(
				new THREE.CylinderGeometry(0.04, 0.04, 0.28, 10),
				mat.clone(),
			);
			handle.position.y = 0.28;
			group.add(handle);
			break;
		}
		case "haymaker": {
			const fist = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.3), mat);
			fist.position.y = 0.11;
			group.add(fist);
			break;
		}
		case "spikes": {
			for (const [x, z, tilt] of [
				[0, 0.08, 0],
				[-0.1, -0.06, 0.22],
				[0.1, -0.06, -0.22],
			] as const) {
				const spike = new THREE.Mesh(
					new THREE.ConeGeometry(0.07, 0.22, 8),
					mat.clone(),
				);
				spike.position.set(x, 0.11, z);
				spike.rotation.x = tilt;
				group.add(spike);
			}
			break;
		}
	}

	group.traverse((node) => {
		if (node instanceof THREE.Mesh) {
			node.castShadow = true;
			node.receiveShadow = true;
		}
	});
	fitPickupScale(group, "bottom");
	return group;
}

function finalizePickupRoot(
	root: THREE.Object3D,
	kind: PowerUpKind,
): THREE.Group {
	const group = root as THREE.Group;
	group.name = `powerUpPickup_${kind}`;
	group.userData.meshyGlb = !group.userData.proceduralFallback;
	root.traverse((node) => {
		if (node instanceof THREE.Mesh) {
			node.castShadow = true;
			node.receiveShadow = true;
		}
	});
	enhancePickupMaterials(
		root,
		kind,
		Boolean(group.userData.proceduralFallback),
	);
	fitPickupScale(root, group.userData.proceduralFallback ? "bottom" : "center");
	return group;
}

async function loadPickupTemplate(kind: PowerUpKind): Promise<THREE.Group> {
	try {
		const loader = createGltfLoader();
		const gltf = await loader.loadAsync(PICKUP_URL[kind]);
		return finalizePickupRoot(gltf.scene, kind);
	} catch {
		console.warn(
			`FlyBall: brak ${PICKUP_URL[kind]} — procedural pickup (${kind})`,
		);
		return createProceduralPowerUpPickup(kind);
	}
}

function fitPickupScale(
	root: THREE.Object3D,
	pivot: "bottom" | "center" = "center",
): void {
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	const size = box.getSize(new THREE.Vector3());
	const longest = Math.max(size.x, size.y, size.z);
	if (longest < 1e-6) return;
	root.scale.multiplyScalar(PICKUP_TARGET_SIZE / longest);
	box.setFromObject(root);
	if (pivot === "bottom") {
		root.position.y -= box.min.y;
	} else {
		const center = box.getCenter(new THREE.Vector3());
		root.position.sub(center);
	}
}

/** Meshy GLB — zachowaj PBR; procedural — team emissive. */
export function enhancePickupMaterials(
	root: THREE.Object3D,
	kind: PowerUpKind,
	procedural: boolean,
): void {
	const accent = POWER_UP_COLORS[kind].three;
	root.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) return;
		const mats = Array.isArray(node.material) ? node.material : [node.material];
		for (const mat of mats) {
			if (
				!(mat instanceof THREE.MeshStandardMaterial) &&
				!(mat instanceof THREE.MeshPhysicalMaterial)
			) {
				continue;
			}
			if (procedural) {
				mat.emissive.setHex(accent);
				mat.emissiveIntensity = 0.55;
				continue;
			}
			if (mat.map || mat.emissiveMap) {
				if (!mat.emissiveMap && mat.map) mat.emissiveMap = mat.map;
				mat.emissive.copy(mat.color);
				mat.emissiveIntensity = 0.22;
			} else {
				mat.emissive.setHex(accent);
				mat.emissiveIntensity = 0.42;
			}
		}
	});
}

async function fetchTemplate(kind: PowerUpKind): Promise<THREE.Group> {
	const cached = templateCache.get(kind);
	if (cached) return cached.clone(true);

	let pending = loadPromises.get(kind);
	if (!pending) {
		pending = loadPickupTemplate(kind).then((root) => {
			templateCache.set(kind, root);
			return root;
		});
		loadPromises.set(kind, pending);
	}

	const template = await pending;
	return template.clone(true);
}

const GPU_WARMUP_POS = new THREE.Vector3(0, -800, 0);

/** Jednorazowy draw ukrytego pickupu — kompilacja shaderów Meshy PBR. */
export function primePowerUpPickupGpu(
	scene: THREE.Scene,
): THREE.Object3D | null {
	const kind = (Object.keys(PICKUP_URL) as PowerUpKind[]).find((k) =>
		templateCache.has(k),
	);
	if (!kind) return null;

	const mesh = templateCache.get(kind)!.clone(true);
	mesh.position.copy(GPU_WARMUP_POS);
	mesh.visible = true;
	scene.add(mesh);
	return mesh;
}

export function clearPowerUpPickupGpuWarmup(
	scene: THREE.Scene,
	obj: THREE.Object3D | null,
): void {
	if (!obj) return;
	scene.remove(obj);
	obj.traverse((node) => {
		if (node instanceof THREE.Mesh) {
			node.geometry.dispose();
			const mats = Array.isArray(node.material)
				? node.material
				: [node.material];
			for (const mat of mats) mat.dispose();
		}
	});
}

/** Prefetch pickupów (Ignition) — GLB lub procedural fallback. */
export function preloadPowerUpPickupModels(): void {
	for (const kind of Object.keys(PICKUP_URL) as PowerUpKind[]) {
		void fetchTemplate(kind);
	}
}

/** Meshy GLB nad dachem auta gdy gracz trzyma power-up. */
export class PowerUpPickupDisplay {
	private readonly anchor = new THREE.Group();
	private shownKind: PowerUpKind | null = null;
	private pendingKind: PowerUpKind | null = null;
	private instance: THREE.Object3D | null = null;

	constructor(parent: THREE.Object3D) {
		this.anchor.name = "powerUpPickup";
		this.anchor.position.set(0, resolveRoofLocalY(parent), 0.05);
		parent.add(this.anchor);
	}

	setHeld(kind: PowerUpKind | null): void {
		if (kind === "spikes") {
			kind = null;
		}
		if (kind === this.shownKind) return;

		this.clearInstance();
		this.shownKind = null;
		this.pendingKind = kind;

		if (!kind) {
			this.anchor.visible = false;
			return;
		}

		const cached = templateCache.get(kind);
		if (cached) {
			this.mount(kind, cached.clone(true));
			return;
		}

		this.anchor.visible = false;
		void fetchTemplate(kind)
			.then((clone) => {
				if (this.pendingKind !== kind) return;
				this.mount(kind, clone);
			})
			.catch(() => {
				if (this.pendingKind === kind) this.pendingKind = null;
			});
	}

	tick(_dt: number): void {
		if (!this.instance) return;
		const roofY = resolveRoofLocalY(this.anchor.parent ?? this.anchor);
		const t = performance.now() * 0.001;
		const pulse = 0.5 + 0.5 * Math.sin(t * 4.8);
		this.anchor.rotation.y = t * 1.4;
		this.anchor.position.y = roofY + Math.sin(t * 3.2) * 0.035;
		this.instance.traverse((node) => {
			if (!(node instanceof THREE.Mesh)) return;
			const mats = Array.isArray(node.material)
				? node.material
				: [node.material];
			for (const mat of mats) {
				if (
					mat instanceof THREE.MeshStandardMaterial ||
					mat instanceof THREE.MeshPhysicalMaterial
				) {
					mat.emissiveIntensity = 0.42 + pulse * 0.38;
				}
			}
		});
	}

	dispose(): void {
		this.clearInstance();
		this.anchor.removeFromParent();
	}

	private mount(kind: PowerUpKind, obj: THREE.Object3D): void {
		this.clearInstance();
		enhancePickupMaterials(
			obj,
			kind,
			Boolean((obj as THREE.Group).userData.proceduralFallback),
		);
		this.instance = obj;
		this.shownKind = kind;
		this.pendingKind = null;
		this.anchor.visible = true;
		this.anchor.add(obj);
	}

	private clearInstance(): void {
		if (!this.instance) return;
		this.anchor.remove(this.instance);
		this.instance = null;
	}
}
