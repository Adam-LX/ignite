import * as THREE from "three";

const WHEEL_NAMES = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;
const FRONT = new Set(["wheel_FL", "wheel_FR"]);

export type WheelRollMesh = {
	mesh: THREE.Mesh;
	baseQuat: THREE.Quaternion;
	/** Legacy — spin idzie na hubie, nie na meshu. */
	rollAxis: THREE.Vector3;
};

export type CarWheelNode = {
	hub: THREE.Object3D;
	baseRotX: number;
	baseRotY: number;
	baseRotZ: number;
	rim: THREE.Object3D | null;
	rimBaseQuat: THREE.Quaternion | null;
	/** Zawsze null — hub X = oś (kontrakt thin-X felg). */
	rimRollAxisLocal: THREE.Vector3 | null;
	rollMeshes: WheelRollMesh[];
	isFront: boolean;
};

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

function collectStockMeshes(hub: THREE.Object3D): THREE.Mesh[] {
	const meshes: THREE.Mesh[] = [];
	hub.traverse((child) => {
		if (!(child instanceof THREE.Mesh)) return;
		if (child.name.startsWith("cosmetic_rim_")) return;
		let p: THREE.Object3D | null = child.parent;
		while (p && p !== hub) {
			if (p.name.startsWith("cosmetic_rim_")) return;
			p = p.parent;
		}
		meshes.push(child);
	});
	return meshes;
}

/**
 * Oś obrotu opony w lokalnym układzie mesha (najbliżej hub +X).
 * Zostawione dla testów / legacy stock — runtime kręci hubem.
 */
export function detectWheelRollAxisLocal(mesh: THREE.Mesh): THREE.Vector3 {
	const hubLateral = new THREE.Vector3(1, 0, 0);
	const candidates = [
		new THREE.Vector3(1, 0, 0),
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(0, 0, 1),
	];
	const world = new THREE.Vector3();
	let best = candidates[0]!;
	let bestDot = -1;
	for (const axis of candidates) {
		world.copy(axis).applyQuaternion(mesh.quaternion).normalize();
		const dot = Math.abs(world.dot(hubLateral));
		if (dot > bestDot) {
			bestDot = dot;
			best = axis;
		}
	}
	return best.clone();
}

function rimMountQuat(rim: THREE.Object3D): THREE.Quaternion {
	const saved = rim.userData.wheelMountQuat;
	if (saved instanceof THREE.Quaternion) {
		return saved.clone();
	}
	if (
		saved &&
		typeof saved === "object" &&
		"x" in saved &&
		"y" in saved &&
		"z" in saved &&
		"w" in saved
	) {
		const q = new THREE.Quaternion(
			Number(saved.x),
			Number(saved.y),
			Number(saved.z),
			Number(saved.w),
		);
		rim.userData.wheelMountQuat = q;
		return q.clone();
	}
	const q = rim.quaternion.clone();
	rim.userData.wheelMountQuat = q.clone();
	return q;
}

export function resolveCarWheels(visualRoot: THREE.Object3D): CarWheelNode[] {
	const car = findCarRoot(visualRoot);
	const nodes: CarWheelNode[] = [];

	for (const name of WHEEL_NAMES) {
		const hub = car.getObjectByName(name);
		if (!hub) continue;

		const rim = hub.getObjectByName(`cosmetic_rim_${name}`) ?? null;
		const rollMeshes: WheelRollMesh[] = [];
		let rimBaseQuat: THREE.Quaternion | null = null;

		if (rim) {
			rimBaseQuat = rimMountQuat(rim);
			rim.quaternion.copy(rimBaseQuat);
		} else {
			for (const mesh of collectStockMeshes(hub)) {
				rollMeshes.push({
					mesh,
					baseQuat: mesh.quaternion.clone(),
					rollAxis: detectWheelRollAxisLocal(mesh),
				});
			}
		}

		hub.rotation.order = "YXZ";
		nodes.push({
			hub,
			baseRotX: 0,
			baseRotY: 0,
			baseRotZ: 0,
			rim,
			rimBaseQuat,
			rimRollAxisLocal: null,
			rollMeshes,
			isFront: FRONT.has(name),
		});
	}

	return nodes;
}

/**
 * Steer hub.Y + roll hub.X (order YXZ).
 * Felgi thin-on-X zostają na mount quat — zero rotateOnWorldAxis / per-mesh spin
 * (to dawało koła „bokiem”).
 */
export function applyCarWheelMotion(
	nodes: CarWheelNode[],
	spinAngle: number,
	steerAngle: number,
): void {
	for (const node of nodes) {
		const { hub, rim, rimBaseQuat, rollMeshes, isFront } = node;

		hub.rotation.order = "YXZ";
		hub.rotation.x = spinAngle;
		hub.rotation.y = isFront ? steerAngle : 0;
		hub.rotation.z = 0;

		if (rim && rimBaseQuat) {
			rim.quaternion.copy(rimBaseQuat);
			continue;
		}

		for (const { mesh, baseQuat } of rollMeshes) {
			mesh.quaternion.copy(baseQuat);
		}
	}
}
