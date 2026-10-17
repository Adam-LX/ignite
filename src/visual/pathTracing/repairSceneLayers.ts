/**
 * Naprawa warstw Three.js po buggy path-trace taggingu.
 * `layers.set(N)` usuwa layer 0 → obiekt znika dla domyślnej kamery.
 * Tu tylko DOŁĄCZAMY layer 0 — nie kasujemy innych warstw.
 */

import * as THREE from "three";

/** Upewnij się, że geometria meczu jest na layer 0 (widoczna dla kamery). */
export function repairSceneLayers(scene: THREE.Scene): void {
	scene.traverse((obj) => {
		if (!obj.layers.isEnabled(0)) obj.layers.enable(0);
	});
}
