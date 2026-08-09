import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { PowerUpKind } from "../../src/modes/IgnitionManager";
import {
	createProceduralPowerUpPickup,
	enhancePickupMaterials,
} from "../../src/visual/powerUpPickupModel";
import { POWER_UP_COLORS } from "../../src/visual/powerUpVisuals";

const KINDS: PowerUpKind[] = ["magnet", "plunger", "haymaker", "spikes"];

describe("createProceduralPowerUpPickup", () => {
	for (const kind of KINDS) {
		it(`tworzy mesh dla ${kind} (~0.42 m)`, () => {
			const root = createProceduralPowerUpPickup(kind);
			expect(root.userData.proceduralFallback).toBe(true);

			const box = new THREE.Box3().setFromObject(root);
			const size = box.getSize(new THREE.Vector3());
			const longest = Math.max(size.x, size.y, size.z);
			expect(longest).toBeGreaterThan(0.34);
			expect(longest).toBeLessThan(0.52);

			let meshCount = 0;
			root.traverse((node) => {
				if (node instanceof THREE.Mesh) meshCount++;
			});
			expect(meshCount).toBeGreaterThan(0);
		});
	}

	it("używa kolorów teamowych z POWER_UP_COLORS (poza czerwonymi biegunami magnetu)", () => {
		const root = createProceduralPowerUpPickup("plunger");
		root.traverse((node) => {
			if (!(node instanceof THREE.Mesh)) return;
			const mat = node.material as THREE.MeshStandardMaterial;
			expect(mat.emissive.getHex()).toBe(POWER_UP_COLORS.plunger.three);
		});
	});
});

describe("enhancePickupMaterials", () => {
	it("zachowuje delikatny glow gdy GLB ma mapę PBR", () => {
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(0.2, 0.2, 0.2),
			new THREE.MeshStandardMaterial({
				color: 0x8844ff,
				map: new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1),
			}),
		);
		const root = new THREE.Group();
		root.add(mesh);

		enhancePickupMaterials(root, "magnet", false);

		const mat = mesh.material as THREE.MeshStandardMaterial;
		expect(mat.emissiveMap).toBe(mat.map);
		expect(mat.emissiveIntensity).toBeCloseTo(0.22, 2);
	});
});
