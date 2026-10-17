/**
 * Overlay VFX — BEZ chowania świata (to dawało skybox-only gdy restore padł).
 * Biblioteka i tak przywraca Points po G-buffer; tu no-op bezpieczny.
 */

import type * as THREE from "three";

export function renderVfxOverlay(
	_renderer: THREE.WebGLRenderer,
	_scene: THREE.Scene,
	_camera: THREE.Camera,
): void {
	/* no-op — mass-hide było szkodliwe */
}

export function tagVfxOverlayLayer(_scene: THREE.Scene): void {
	/* no-op */
}

export const VFX_OVERLAY_LAYER = 2;
