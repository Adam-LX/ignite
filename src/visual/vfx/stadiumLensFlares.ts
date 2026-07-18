import * as THREE from "three";

import type { StadiumLightingRig } from "../stadiumLighting";
import type { LensFlareLight } from "../shaders/lensFlarePost";
import { STADIUM_PYLON_SPECS } from "../stadiumPylons";

/**
 * Źródła flar stadionu — tylko pozycje światowe (post-process robi resztę).
 * Bez THREE.Lensflare / sprite'ów w scenie.
 */
export type StadiumLensFlares = {
	setEnabled: (enabled: boolean) => void;
	setDriveIntensity: (amount: number) => void;
	/** Projektuj światła do UV kamery → lista dla LensFlarePost. */
	collectLights: (camera: THREE.Camera) => LensFlareLight[];
	syncFromRig: (rig: StadiumLightingRig) => void;
	dispose: () => void;
};

type Source = {
	world: THREE.Vector3;
	color: THREE.Color;
	weight: number;
	/** Live Object3D — jeśli ustawione, pozycja brana co klatkę. */
	obj?: THREE.Object3D;
};

export function createStadiumLensFlares(
	_scene: THREE.Scene,
	rig: StadiumLightingRig,
): StadiumLensFlares {
	const sources: Source[] = [
		/** Wszystkie pylony (także te bez DirectionalLight) — flary na niebie. */
		...STADIUM_PYLON_SPECS.map((spec, i) => ({
			world: new THREE.Vector3(spec.x, spec.height + 1.1, spec.z),
			color: new THREE.Color(i % 2 === 0 ? 0xffe8c8 : 0xc8e4ff),
			weight: 1.55,
		})),
		...rig.pitchLights.map((l) => ({
			world: new THREE.Vector3(),
			obj: l as THREE.Object3D,
			color: new THREE.Color(0xd8ecff),
			weight: 1.25,
		})),
		...rig.cornerSpots.map((l, i) => ({
			world: new THREE.Vector3(),
			obj: l as THREE.Object3D,
			color: new THREE.Color(i % 2 === 0 ? 0xffd0a0 : 0xb8dcff),
			weight: 1.2,
		})),
		{
			world: new THREE.Vector3(),
			obj: rig.primaryShadow as THREE.Object3D,
			color: new THREE.Color(0xfff0d8),
			weight: 0.85,
		},
	];

	let enabled = false;
	let drive = 1;
	const _ndc = new THREE.Vector3();
	const _view = new THREE.Vector3();

	return {
		setEnabled(next) {
			enabled = next;
		},
		setDriveIntensity(amount) {
			drive = THREE.MathUtils.clamp(amount, 0.55, 1.85);
		},
		syncFromRig(_rig) {
			/* pozycje brane na żywo z Object3D / specs */
		},
		collectLights(camera) {
			if (!enabled) return [];
			const out: LensFlareLight[] = [];
			camera.updateMatrixWorld();
			const viewMatrix = camera.matrixWorldInverse;

			for (const src of sources) {
				if (src.obj) {
					src.obj.getWorldPosition(src.world);
				}
				_view.copy(src.world).applyMatrix4(viewMatrix);
				/** DirectionalLight: za kamerą w view-space = +Z w Three (kamera patrzy −Z). */
				if (_view.z > 0.35) continue;

				_ndc.copy(src.world).project(camera);
				if (
					!Number.isFinite(_ndc.x) ||
					!Number.isFinite(_ndc.y) ||
					Math.abs(_ndc.x) > 1.75 ||
					Math.abs(_ndc.y) > 1.75
				) {
					continue;
				}

				const uv = new THREE.Vector2(_ndc.x * 0.5 + 0.5, _ndc.y * 0.5 + 0.5);
				/**
				 * Jupitery lądują na górze / brzegach kadru — nie karz edge falloffem.
				 * Bonus za „niebo” (wysokie UV.y).
				 * Blisko kamery + w centrum = wjechano w snop → ścisz flarę.
				 */
				const skyBias = THREE.MathUtils.clamp(uv.y * 0.65 + 0.5, 0.55, 1.35);
				const edgeKeep = THREE.MathUtils.clamp(
					0.7 + (1 - Math.abs(_ndc.x)) * 0.25,
					0.55,
					1.4,
				);
				const camDist = _view.length();
				const nearBlind =
					THREE.MathUtils.smoothstep(camDist, 14, 38) *
					(0.35 +
						0.65 *
							THREE.MathUtils.clamp(
								Math.hypot(uv.x - 0.5, uv.y - 0.5) * 2.2,
								0,
								1,
							));
				const strength =
					src.weight * drive * skyBias * edgeKeep * Math.max(0.22, nearBlind);
				out.push({ uv, strength, color: src.color });
			}

			out.sort((a, b) => b.strength - a.strength);
			return out.slice(0, 8);
		},
		dispose() {
			sources.length = 0;
		},
	};
}
