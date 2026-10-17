import * as THREE from "three";

/**
 * Maska nadkoli (shader discard) — WYŁĄCZONA.
 * Agresywny discard dziurawił karoserię Trellis; włącz dopiero po ciaśniejszym
 * RADIUS_SCALE + testach GLB. API zostaje, żeby call-site’y nie padały.
 */

/** Ukrywa baked koła w meshu body w strefie hubów z cosmetic_rim_*. */
export function applyBodyWheelWellMask(
	_root: THREE.Object3D,
	_carId?: string | null,
): boolean {
	return false;
}

/** Miniaturki / podgląd bez felg — maska na pustych hubach (baked koła w body). */
export function applyBodyWheelWellMaskForEmptyHubs(
	_root: THREE.Object3D,
	_carId?: string | null,
): boolean {
	return false;
}

export function clearBodyWheelWellMask(_root: THREE.Object3D): void {
	/* no-op — maska nie instalowana */
}

/** Po snapie kół — odśwież centra masek w lokalnym układzie body. */
export function refreshBodyWheelWellMaskIfMounted(_root: THREE.Object3D): void {
	/* no-op */
}
