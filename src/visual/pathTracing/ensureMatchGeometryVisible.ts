/**
 * Widoczność meczu — bez proxy. Tanie: tylko gdy coś wygląda na ukryte.
 */

import * as THREE from "three";

import { disposeArenaRtProxy } from "./ArenaRtProxy";

const FORCE_VISIBLE =
	/full_rl_stadium|pitchfloor|pitch_floor|soccar|goalframe|goalnet|backboard|octane|chassis|^ball$|playerCar|carRoot/i;

export function ensureMatchGeometryVisible(scene: THREE.Scene): void {
	disposeArenaRtProxy(scene);
	scene.traverse((obj) => {
		const n = obj.name || "";
		if (
			FORCE_VISIBLE.test(n) ||
			obj.userData?.isCar === true ||
			obj.userData?.isBall === true
		) {
			if (!obj.visible) obj.visible = true;
			if (!obj.layers.isEnabled(0)) obj.layers.enable(0);
		}
	});
}
