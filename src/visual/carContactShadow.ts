import * as THREE from "three";

const SHADOW_GEO = new THREE.CircleGeometry(1, 32);

/** Miękki cień kontaktowy — auto „siedzi” na murawie (premium grounding). */
export function mountCarContactShadow(
	car: THREE.Group,
	team: "blue" | "orange",
): void {
	const existing = car.getObjectByName("contactShadow");
	if (existing) existing.parent?.remove(existing);

	car.updateMatrixWorld(true);
	const body = car.getObjectByName("body") ?? car;
	const box = new THREE.Box3().setFromObject(body);
	const w = box.max.x - box.min.x;
	const l = box.max.z - box.min.z;
	const radius = Math.max(w, l) * 0.52;
	const y = box.min.y + 0.018;

	const tint = team === "blue" ? 0x061018 : 0x100608;
	const mat = new THREE.MeshBasicMaterial({
		color: tint,
		transparent: true,
		opacity: 0.38,
		depthWrite: false,
	});
	const disc = new THREE.Mesh(SHADOW_GEO, mat);
	disc.name = "contactShadow";
	disc.rotation.x = -Math.PI / 2;
	disc.scale.set(radius, radius, 1);
	disc.position.set(
		(box.min.x + box.max.x) * 0.5,
		y,
		(box.min.z + box.max.z) * 0.5,
	);
	disc.renderOrder = -2;
	car.add(disc);
}
