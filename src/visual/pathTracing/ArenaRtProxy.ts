/**
 * Usuwa leftover ArenaRtProxy (stare buildy zostawiały wielkie panele w kadrze).
 * Nowe sesje NIE tworzą proxy — BVH = pitch/auta/piłka/bramki + ambient/sky.
 */

import * as THREE from "three";

export const ARENA_RT_PROXY_NAME = "arenaRtProxy";

export function ensureArenaRtProxy(_scene: THREE.Scene): null {
	return null;
}

export function hideArenaRtProxyForGBuffer(): void {
	/* no-op */
}

export function disposeArenaRtProxy(scene?: THREE.Scene): void {
	if (!scene) return;
	const victims: THREE.Object3D[] = [];
	scene.traverse((obj) => {
		if (
			obj.userData?.arenaRtProxy === true ||
			obj.name === ARENA_RT_PROXY_NAME ||
			/^arenaRtProxy/i.test(obj.name)
		) {
			victims.push(obj);
		}
	});
	for (const obj of victims) {
		obj.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			o.geometry?.dispose();
			const m = o.material;
			if (Array.isArray(m)) m.forEach((x) => x.dispose());
			else if (m) m.dispose();
		});
		obj.removeFromParent();
	}
}
