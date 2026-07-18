import * as THREE from "three";
import { assetUrl } from "../util/assetUrl";
import { createGltfLoader } from "../util/gltfLoader";
import { RL_CAR } from "../util/rlConstants";
import {
	visualLowestY,
	wheelContactMinY,
} from "./carWheelGround";
import {
	CAR_VISUAL_SCALE,
	OCTANE_LENGTH,
	OCTANE_VISUAL_WIDTH,
} from "./octaneCarMesh";

const GLB_PATH = assetUrl("/assets/models/player_car.glb");

let cachedGlb: THREE.Group | null = null;

async function fetchBaseGlb(): Promise<THREE.Group> {
	if (cachedGlb) return cachedGlb.clone(true);

	const loader = createGltfLoader();
	const gltf = await loader.loadAsync(GLB_PATH);
	const scene = gltf.scene;
	scene.name = "octaneCar";
	// Blender: przód = −Z → Three.js: +Z
	scene.rotation.y = Math.PI;

	cachedGlb = scene;
	return scene.clone(true);
}

function fitToHitboxScale(root: THREE.Object3D): void {
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	const size = box.getSize(new THREE.Vector3());
	const scale = Math.min(OCTANE_VISUAL_WIDTH / size.x, OCTANE_LENGTH / size.z);
	root.scale.multiplyScalar(scale * CAR_VISUAL_SCALE);
}

/**
 * Dno wizualne (preferuj opony) = dół hitboxa Rapiera (−hitboxHalfY).
 * Idempotentne: najpierw zeruje Y, potem mierzy od spodu.
 * Wspólne dla wszystkich aut (Trellis + legacy GLB).
 */
export function alignCarToHitbox(visualRoot: THREE.Object3D): void {
	visualRoot.position.y = 0;
	visualRoot.updateMatrixWorld(true);
	const ground =
		wheelContactMinY(visualRoot) ?? visualLowestY(visualRoot);
	visualRoot.position.y = -RL_CAR.hitboxHalfY - ground;
}

export function applyTeamPaint(
	root: THREE.Object3D,
	team: "blue" | "orange",
): void {
	const body = team === "blue" ? 0x1ec8ee : 0xff5522;
	const dark = team === "blue" ? 0x0e5f75 : 0x9a3510;

	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const mat of mats) {
			if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
			const label = `${mat.name}|${obj.name}`.toLowerCase();
			if (label.includes("dark") || label.includes("inset")) {
				mat.color.setHex(dark);
				mat.emissive.setHex(dark).multiplyScalar(0.04);
			} else if (
				label.includes("paint") ||
				label.includes("body") ||
				label.includes("hood") ||
				label.includes("cabin") ||
				label.includes("spoiler") ||
				label.includes("scoop") ||
				label.includes("fender") ||
				label.includes("pylon")
			) {
				mat.color.setHex(body);
				mat.emissive.setHex(body).multiplyScalar(0.07);
				mat.emissiveIntensity = 1.2;
			}
		}
	});
}

export async function createCarMeshFromGlb(
	team: "blue" | "orange",
): Promise<THREE.Group> {
	const car = (await fetchBaseGlb()) as THREE.Group;
	car.name = "octaneCar";
	fitToHitboxScale(car);
	applyTeamPaint(car, team);
	alignCarToHitbox(car);

	car.traverse((obj) => {
		obj.frustumCulled = false;
		if (obj instanceof THREE.Mesh) {
			obj.castShadow = true;
			obj.receiveShadow = true;
			obj.geometry?.computeBoundingSphere();
		}
	});

	return car;
}

export function isCarGlbCached(): boolean {
	return cachedGlb !== null;
}
