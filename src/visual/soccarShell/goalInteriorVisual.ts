/**
 * Wnętrze bramki — BEZ matowych „desek”.
 * Wygląd = siatki z `goalFrameVisual.addNets` (ten sam grid co boki).
 * Tu tylko ciemny seal podłogi, żeby near-plane nie pokazywał skyboxa.
 */
import type * as THREE from "three";

import type { GoalShellSide } from "./profiles";

/**
 * Kieszeń wizualnie = same siatki portalu.
 * Wcześniej curved back/sides + opaque backing = czarne „wewnętrzne ściany” (klip F9).
 */
export function buildGoalInteriorShell(
	_parent: THREE.Object3D,
	_team: GoalShellSide,
): void {
	/* no-op — panele usunięte; siatki buduje buildSoccarGoalFrame → addNets */
}
