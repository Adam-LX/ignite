import * as THREE from "three";

const HIDE_NAME =
	/shield|bubble|forcefield|collider|hitbox|bounds|debug|sphere|aura|glow_shell|field/i;

/**
 * Usuwa / ukrywa sferyczne debug-meshe i półprzezroczyste „bańki” z GLB lub sceny.
 */
export function sanitizeCarVisuals(root: THREE.Object3D): void {
	const toRemove: THREE.Object3D[] = [];
	const size = new THREE.Vector3();

	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;

		const name = obj.name;
		if (HIDE_NAME.test(name)) {
			toRemove.push(obj);
			return;
		}

		const geo = obj.geometry;
		if (geo instanceof THREE.SphereGeometry) {
			toRemove.push(obj);
			return;
		}

		if (!geo.boundingBox) geo.computeBoundingBox();
		if (!geo.boundingSphere) geo.computeBoundingSphere();
		const box = geo.boundingBox;
		const bs = geo.boundingSphere;
		if (!box || !bs) return;

		box.getSize(size);
		const maxD = Math.max(size.x, size.y, size.z);
		const minD = Math.min(size.x, size.y, size.z);
		const round = maxD > 0 ? minD / maxD : 0;

		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		const anyTransparent = mats.some(
			(m) => m.transparent && (m.opacity < 0.95 || "transmission" in m),
		);

		// Prawie kuliste, duże, przezroczyste — typowa „bańka” kolizji / osłony
		if (
			round > 0.82 &&
			bs.radius > 0.8 &&
			anyTransparent &&
			!/window|glass|wind/i.test(name)
		) {
			toRemove.push(obj);
		}
	});

	for (const obj of toRemove) {
		obj.parent?.remove(obj);
		if (obj instanceof THREE.Mesh) {
			obj.geometry.dispose();
			const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
			for (const m of mats) m.dispose();
		}
	}
}
