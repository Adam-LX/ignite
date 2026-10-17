/**
 * UE6-style lacquer punch — clearcoat / IBL na autach i piłce gdy PT ON.
 * Nie rusza murawy (pitchWetness ma własny path).
 */

import * as THREE from "three";

import { isPathTraceLookEnabled } from "../../util/presentationPrefs";

const stamped = new WeakSet<THREE.Material>();

function isLacquerTarget(obj: THREE.Object3D): boolean {
	let p: THREE.Object3D | null = obj;
	while (p) {
		const n = (p.name || "").toLowerCase();
		if (
			/car|chassis|body|paint|ball|octane|vehicle/i.test(n) ||
			p.userData?.isCar === true ||
			p.userData?.isBall === true
		) {
			return true;
		}
		p = p.parent;
	}
	return false;
}

export function applyPathTraceLacquer(root: THREE.Object3D): void {
	const pt = isPathTraceLookEnabled();
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		if (!isLacquerTarget(obj)) return;
		const isBall =
			obj.userData?.isBall === true ||
			/ball/i.test(obj.name || "") ||
			/ball/i.test(obj.parent?.name || "");
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const mat of mats) {
			if (
				!(
					mat instanceof THREE.MeshStandardMaterial ||
					mat instanceof THREE.MeshPhysicalMaterial
				)
			) {
				continue;
			}
			if (!stamped.has(mat)) {
				mat.userData.ignitePtEnv = mat.envMapIntensity;
				mat.userData.ignitePtRough = mat.roughness;
				if (mat instanceof THREE.MeshPhysicalMaterial) {
					mat.userData.ignitePtCc = mat.clearcoat;
					mat.userData.ignitePtCcR = mat.clearcoatRoughness;
				}
				stamped.add(mat);
			}
			const baseEnv = (mat.userData.ignitePtEnv as number) ?? 1;
			const baseRough = (mat.userData.ignitePtRough as number) ?? 0.4;
			/** Lacquer: body = UE6 gloss; ball = PBR, bez podwójnego neon punch. */
			const envMul = isBall ? 1.15 : 1.35;
			const roughMul = isBall ? 0.9 : 0.72;
			mat.envMapIntensity = pt ? baseEnv * envMul : baseEnv * 0.85;
			mat.roughness = pt
				? Math.max(isBall ? 0.08 : 0.03, baseRough * roughMul)
				: Math.min(0.85, baseRough * 1.12);
			if (mat instanceof THREE.MeshPhysicalMaterial) {
				const cc = (mat.userData.ignitePtCc as number) ?? mat.clearcoat;
				const ccr =
					(mat.userData.ignitePtCcR as number) ?? mat.clearcoatRoughness;
				mat.clearcoat = pt
					? Math.min(
							1,
							Math.max(
								isBall ? 0.85 : 0.78,
								cc * (isBall ? 1.08 : 1.28) + (isBall ? 0.04 : 0.12),
							),
						)
					: Math.min(0.35, cc * 0.55);
				mat.clearcoatRoughness = pt
					? Math.max(isBall ? 0.03 : 0.015, ccr * (isBall ? 0.7 : 0.4))
					: Math.min(0.55, ccr * 1.35);
			}
		}
	});
}
