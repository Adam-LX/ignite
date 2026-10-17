import type RAPIER from "@dimforge/rapier3d-compat";
import { ShapeType } from "@dimforge/rapier3d-compat";

/**
 * Body handlery ignorowane przez raycasty zawieszenia (piłka, inne auta).
 * Bez tego koła „stoją” na piłce → tip / wywrotka przy podjeździe.
 */
const ignoreBodyHandles = new Set<number>();

export function registerHoverRayIgnoreBody(
	body: RAPIER.RigidBody | null | undefined,
): void {
	if (!body) return;
	ignoreBodyHandles.add(body.handle);
}

export function unregisterHoverRayIgnoreBody(
	body: RAPIER.RigidBody | null | undefined,
): void {
	if (!body) return;
	ignoreBodyHandles.delete(body.handle);
}

export function clearHoverRayIgnoreBodies(): void {
	ignoreBodyHandles.clear();
}

/** true = collider OK jako podłoże dla zawieszenia. */
export function hoverRayColliderPredicate(
	collider: RAPIER.Collider,
): boolean {
	const parent = collider.parent();
	if (parent && ignoreBodyHandles.has(parent.handle)) return false;
	if (collider.shapeType() === ShapeType.Ball) return false;
	return true;
}
