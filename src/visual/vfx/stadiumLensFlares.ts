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
		/** Pylony — flary lokalne, nie myją horyzontu. */
		...STADIUM_PYLON_SPECS.map((spec, i) => ({
			world: new THREE.Vector3(spec.x, spec.height + 1.1, spec.z),
			color: new THREE.Color(i % 2 === 0 ? 0xffe8c8 : 0xc8e4ff),
			weight: 0.85,
		})),
		...rig.pitchLights.map((l) => ({
			world: new THREE.Vector3(),
			obj: l as THREE.Object3D,
			color: new THREE.Color(0xd8ecff),
			weight: 0.7,
		})),
		...rig.cornerSpots.map((l, i) => ({
			world: new THREE.Vector3(),
			obj: l as THREE.Object3D,
			color: new THREE.Color(i % 2 === 0 ? 0xffd0a0 : 0xb8dcff),
			weight: 0.65,
		})),
		{
			world: new THREE.Vector3(),
			obj: rig.primaryShadow as THREE.Object3D,
			color: new THREE.Color(0xfff0d8),
			weight: 0.4,
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
			drive = THREE.MathUtils.clamp(amount, 0.5, 1.65);
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
					Math.abs(_ndc.x) > 1.65 ||
					Math.abs(_ndc.y) > 1.65
				) {
					continue;
				}

				const uv = new THREE.Vector2(_ndc.x * 0.5 + 0.5, _ndc.y * 0.5 + 0.5);
				const edgeKeep = THREE.MathUtils.clamp(
					0.7 + (1 - Math.abs(_ndc.x)) * 0.28,
					0.55,
					1.25,
				);
				const centerDist = Math.hypot(uv.x - 0.5, uv.y - 0.5);
				const centerHit =
					1 + (1 - THREE.MathUtils.clamp(centerDist * 2.4, 0, 1)) * 0.35;
				const camDist = _view.length();
				const nearKeep = THREE.MathUtils.clamp(
					THREE.MathUtils.smoothstep(camDist, 12, 36),
					0.35,
					1,
				);
				const skyMute = THREE.MathUtils.clamp(1.05 - uv.y * 0.3, 0.7, 1);
				const strength =
					src.weight * drive * edgeKeep * centerHit * skyMute * nearKeep;
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
