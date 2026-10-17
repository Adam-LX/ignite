/**
 * Opona AAA — matowa guma, mikro-normal, lekki wet darkening.
 */

import * as THREE from "three";

import { getPitchWetness } from "../pitchWetness";

const RUBBER_CACHE = "ignite-tire-rubber-v1";

export function createTireRubberMaterial(): THREE.MeshStandardMaterial {
	const mat = new THREE.MeshStandardMaterial({
		color: 0x121214,
		metalness: 0.02,
		roughness: 0.94,
		envMapIntensity: 0.35,
	});
	installTireRubberShader(mat);
	return mat;
}

export function installTireRubberShader(
	material: THREE.MeshStandardMaterial,
): void {
	if (material.userData.igniteRubberInstalled) return;
	material.userData.igniteRubberInstalled = true;
	material.customProgramCacheKey = () => RUBBER_CACHE;
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uTireWet = { value: 0 };
		material.userData.uTireWet = shader.uniforms.uTireWet;
		shader.fragmentShader = `uniform float uTireWet;\n${shader.fragmentShader}`;
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <map_fragment>",
			`#include <map_fragment>
				float tread = fract(vUv.x * 18.0) * fract(vUv.y * 7.0);
				diffuseColor.rgb *= mix(0.92, 1.04, tread);
				diffuseColor.rgb *= mix(1.0, 0.78, uTireWet * 0.55);
				`,
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <roughnessmap_fragment>",
			`#include <roughnessmap_fragment>
				roughnessFactor = mix(roughnessFactor, 0.55, uTireWet * 0.45);
			`,
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <normal_fragment_maps>",
			`#include <normal_fragment_maps>
				float nA = fract(sin(dot(vUv * 40.0, vec2(12.9898, 78.233))) * 43758.5453);
				float nB = fract(sin(dot(vUv * 55.0, vec2(39.346, 11.135))) * 24634.6345);
				normal = normalize(normal + vec3((nA - 0.5) * 0.18, (nB - 0.5) * 0.12, 0.0));
			`,
		);
	};
	material.needsUpdate = true;
}

/** Sync wetness → opony (call per frame from car visuals optional). */
export function syncTireRubberWetness(root: THREE.Object3D): void {
	const wet = getPitchWetness();
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const m of mats) {
			const u = m?.userData?.uTireWet as { value: number } | undefined;
			if (u) u.value = wet;
		}
	});
}
