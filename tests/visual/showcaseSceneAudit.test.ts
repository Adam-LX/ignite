import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	calmShowcaseCarMaterials,
	countShowcaseHeroCars,
	hideShowcaseGhostMeshes,
} from "../../src/visual/showcaseSceneAudit";

describe("showcaseSceneAudit", () => {
	it("hideShowcaseGhostMeshes ukrywa przezroczyste meshe", () => {
		const root = new THREE.Group();
		const bubble = new THREE.Mesh(
			new THREE.SphereGeometry(1),
			new THREE.MeshStandardMaterial({
				transparent: true,
				opacity: 0.4,
			}),
		);
		bubble.name = "shield_bubble";
		root.add(bubble);
		hideShowcaseGhostMeshes(root);
		expect(bubble.visible).toBe(false);
	});

	it("hideShowcaseGhostMeshes nie ukrywa mesh body (nawet z transmission)", () => {
		const root = new THREE.Group();
		const body = new THREE.Mesh(
			new THREE.BoxGeometry(1, 0.4, 1.6),
			new THREE.MeshPhysicalMaterial({
				transparent: true,
				opacity: 0.5,
				transmission: 0.4,
			}),
		);
		body.name = "body";
		root.add(body);
		hideShowcaseGhostMeshes(root);
		expect(body.visible).toBe(true);
	});

	it("calmShowcaseCarMaterials zeruje envMapIntensity", () => {
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({ envMapIntensity: 2.6 }),
		);
		const root = new THREE.Group();
		root.add(mesh);
		calmShowcaseCarMaterials(root);
		const mat = mesh.material as THREE.MeshStandardMaterial;
		expect(mat.envMapIntensity).toBe(0);
	});

	it("calmShowcaseCarMaterials wyłącza clearcoat / iridescence", () => {
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshPhysicalMaterial({
				clearcoat: 0.9,
				iridescence: 0.7,
			}),
		);
		const root = new THREE.Group();
		root.add(mesh);
		calmShowcaseCarMaterials(root);
		const mat = mesh.material as THREE.MeshPhysicalMaterial;
		expect(mat.clearcoat).toBe(0);
		expect(mat.iridescence).toBe(0);
	});

	it("countShowcaseHeroCars — jeden hero w menuShowcase", () => {
		const scene = new THREE.Scene();
		const showcase = new THREE.Group();
		showcase.name = "menuShowcase";
		const hero = new THREE.Group();
		hero.name = "menuHeroCar";
		showcase.add(hero);
		scene.add(showcase);
		expect(countShowcaseHeroCars(scene)).toBe(1);
	});
});
