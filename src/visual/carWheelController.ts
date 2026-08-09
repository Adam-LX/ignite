import * as THREE from "three";

const WHEEL_NAMES = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;
const FRONT = new Set(["wheel_FL", "wheel_FR"]);
const HUB_LATERAL = new THREE.Vector3(1, 0, 0);
const AXIS_CANDIDATES = [
	new THREE.Vector3(1, 0, 0),
	new THREE.Vector3(0, 1, 0),
	new THREE.Vector3(0, 0, 1),
] as const;

const _axisWorld = new THREE.Vector3();

export type WheelRollMesh = {
	mesh: THREE.Mesh;
	baseQuat: THREE.Quaternion;
	rollAxis: THREE.Vector3;
};

export type CarWheelNode = {
	hub: THREE.Object3D;
	baseRotX: number;
	baseRotY: number;
	baseRotZ: number;
	rollMeshes: WheelRollMesh[];
	isFront: boolean;
};

/** Znajdź hub koła w klonie auta (octaneCarDisplay → octaneCar). */
function findCarRoot(root: THREE.Object3D): THREE.Object3D {
	if (root.getObjectByName("octaneCar")) return root;
	let node: THREE.Object3D | null = root;
	while (node) {
		if (node.name === "octaneCar" || node.name === "octaneCarDisplay")
			return node;
		node = node.parent;
	}
	return root;
}

function collectRollMeshes(hub: THREE.Object3D): THREE.Mesh[] {
	const cosmetic = hub.getObjectByName(`cosmetic_rim_${hub.name}`);
	if (cosmetic) {
		const meshes: THREE.Mesh[] = [];
		cosmetic.traverse((child) => {
			if (child instanceof THREE.Mesh) meshes.push(child);
		});
		return meshes;
	}

	const meshes: THREE.Mesh[] = [];
	hub.traverse((child) => {
		if (child instanceof THREE.Mesh) meshes.push(child);
	});
	return meshes;
}

/** Oś obrotu opony w lokalnym układzie mesha (najbliżej osi poprzecznej huba). */
export function detectWheelRollAxisLocal(mesh: THREE.Mesh): THREE.Vector3 {
	let best = AXIS_CANDIDATES[0];
	let bestDot = -1;

	for (const axis of AXIS_CANDIDATES) {
		_axisWorld.copy(axis).applyQuaternion(mesh.quaternion).normalize();
		const dot = Math.abs(_axisWorld.dot(HUB_LATERAL));
		if (dot > bestDot) {
			bestDot = dot;
			best = axis;
		}
	}

	return best.clone();
}

export function resolveCarWheels(visualRoot: THREE.Object3D): CarWheelNode[] {
	const car = findCarRoot(visualRoot);
	const nodes: CarWheelNode[] = [];

	for (const name of WHEEL_NAMES) {
		const hub = car.getObjectByName(name);
		if (!hub) continue;

		const rollMeshes: WheelRollMesh[] = [];
		for (const mesh of collectRollMeshes(hub)) {
			rollMeshes.push({
				mesh,
				baseQuat: mesh.quaternion.clone(),
				rollAxis: detectWheelRollAxisLocal(mesh),
			});
		}

		nodes.push({
			hub,
			baseRotX: hub.rotation.x,
			baseRotY: hub.rotation.y,
			baseRotZ: hub.rotation.z,
			rollMeshes,
			isFront: FRONT.has(name),
		});
	}

	return nodes;
}

/** Steer na hub (Y), roll przez rotateOnAxis — bez reparentowania GLB. */
export function applyCarWheelMotion(
	nodes: CarWheelNode[],
	spinAngle: number,
	steerAngle: number,
): void {
	for (const {
		hub,
		baseRotX,
		baseRotY,
		baseRotZ,
		rollMeshes,
		isFront,
	} of nodes) {
		hub.rotation.x = baseRotX;
		hub.rotation.z = baseRotZ;
		hub.rotation.y = isFront ? baseRotY + steerAngle : baseRotY;

		for (const { mesh, baseQuat, rollAxis } of rollMeshes) {
			mesh.quaternion.copy(baseQuat);
			mesh.rotateOnAxis(rollAxis, spinAngle);
		}
	}
}
