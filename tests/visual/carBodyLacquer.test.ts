import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";

import { applyPaintToCar } from "../../src/visual/applyPaintCosmetic";
import {
	BODY_EMISSIVE_MATCH,
	BODY_EMISSIVE_SHOWCASE,
	MIN_BODY_PAINT_LUMA,
	SHOWCASE_BODY_HEX,
	TEAM_BODY_PAINT,
	applyBodyLacquerToMaterial,
	colorLuma,
	createNaturalBodyLacquerMaterial,
	floorColorLuma,
	isNaturalBodyLacquer,
	isReadableBodyLacquer,
} from "../../src/visual/carBodyLacquer";
import {
	createCarAccentMaterial,
	createCarBodyClearcoatMaterial,
	createCarChromeMaterial,
	createIridescentChromeMaterial,
} from "../../src/visual/carPanelMaterial";
import { setPaintCatalogForTests } from "../../src/meta/PaintCatalog";

describe("carBodyLacquer natural (jak miniaturka)", () => {
	it("natural body is not team blue/orange solid", () => {
		const mat = createNaturalBodyLacquerMaterial();
		expect(mat.color.getHex()).toBe(SHOWCASE_BODY_HEX);
		expect(mat.color.getHex()).not.toBe(TEAM_BODY_PAINT.blue);
		expect(mat.color.getHex()).not.toBe(TEAM_BODY_PAINT.orange);
		expect(isNaturalBodyLacquer(mat)).toBe(true);
		mat.dispose();
	});

	it("match lacquer stays readable without cyan skybox wash", () => {
		const match = createNaturalBodyLacquerMaterial();
		const showcase = createNaturalBodyLacquerMaterial({ showcase: true });
		expect(match.emissiveIntensity).toBe(BODY_EMISSIVE_MATCH);
		expect(showcase.emissiveIntensity).toBe(BODY_EMISSIVE_SHOWCASE);
		expect(match.emissiveIntensity).toBeLessThanOrEqual(0.12);
		expect(match.envMapIntensity).toBeLessThanOrEqual(1.15);
		expect(match.toneMapped).toBe(true);
		expect(match.clearcoat).toBeGreaterThanOrEqual(0.5);
		expect(match.color.getHex()).not.toBe(TEAM_BODY_PAINT.blue);
		match.dispose();
		showcase.dispose();
	});

	it("floorColorLuma lifts near-black paints", () => {
		const lifted = floorColorLuma(0x111111);
		expect(colorLuma(lifted)).toBeGreaterThanOrEqual(MIN_BODY_PAINT_LUMA);
	});

	it("team accent hexes stay readable for underglow", () => {
		expect(colorLuma(TEAM_BODY_PAINT.blue)).toBeGreaterThanOrEqual(
			MIN_BODY_PAINT_LUMA,
		);
		expect(colorLuma(TEAM_BODY_PAINT.orange)).toBeGreaterThanOrEqual(
			MIN_BODY_PAINT_LUMA,
		);
	});
});

describe("carPanelMaterial night-safe", () => {
	it("chrome is neutral silver — not solid team blue/orange", () => {
		for (const team of ["blue", "orange"] as const) {
			const chrome = createIridescentChromeMaterial(team);
			expect(chrome.metalness).toBeLessThanOrEqual(0.35);
			expect(chrome.toneMapped).toBe(true);
			expect(chrome.emissiveIntensity).toBeLessThanOrEqual(0.12);
			expect(chrome.color.getHex()).not.toBe(TEAM_BODY_PAINT.blue);
			expect(chrome.color.getHex()).not.toBe(TEAM_BODY_PAINT.orange);
			chrome.dispose();

			const accent = createCarAccentMaterial(team);
			expect(accent.metalness).toBeLessThanOrEqual(0.35);
			expect(accent.toneMapped).toBe(true);
			expect(accent.emissiveIntensity).toBeLessThanOrEqual(0.25);
			accent.dispose();

			const alias = createCarChromeMaterial(team);
			expect(alias.metalness).toBeLessThanOrEqual(0.35);
			alias.dispose();
		}
	});

	it("clearcoat body is not full-metal black", () => {
		const mat = createCarBodyClearcoatMaterial();
		expect(mat.metalness).toBeLessThanOrEqual(0.4);
		expect(mat.clearcoat).toBeGreaterThanOrEqual(0.5);
		expect(mat.toneMapped).toBe(true);
		mat.dispose();
	});
});

describe("applyPaintToCar", () => {
	afterEach(() => {
		setPaintCatalogForTests(null);
	});

	function makeBodyRoot(): THREE.Group {
		const root = new THREE.Group();
		const body = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({
				name: "paint_body",
				color: 0x111111,
				metalness: 1,
				map: new THREE.DataTexture(new Uint8Array([10, 10, 10, 255]), 1, 1),
			}),
		);
		body.name = "body";
		root.add(body);
		return root;
	}

	it("applies chromatic paint as solid readable lacquer (no natural map)", () => {
		setPaintCatalogForTests({
			schemaVersion: 1,
			paints: [
				{
					id: "crimson",
					nameKey: "paint.crimson",
					hex: "0xcc1122",
					accentHex: "0x660811",
					rarity: "rare",
					finish: "standard",
				},
			],
		});
		const root = makeBodyRoot();
		applyPaintToCar(root, "crimson", "blue");
		const mat = (root.getObjectByName("body") as THREE.Mesh)
			.material as THREE.MeshStandardMaterial;
		expect(mat.map).toBeNull();
		expect(mat.userData.naturalAlbedo).toBeFalsy();
		expect(isReadableBodyLacquer(mat)).toBe(true);
		expect(colorLuma(mat.color.getHex())).toBeGreaterThanOrEqual(
			MIN_BODY_PAINT_LUMA,
		);
		expect(mat.color.getHex()).not.toBe(TEAM_BODY_PAINT.blue);
	});

	it("natural albedo keeps map — paint only tints (no solid blue wipe)", () => {
		setPaintCatalogForTests({
			schemaVersion: 1,
			paints: [
				{
					id: "crimson",
					nameKey: "paint.crimson",
					hex: "0xcc1122",
					accentHex: "0x660811",
					rarity: "rare",
					finish: "standard",
				},
			],
		});
		const root = new THREE.Group();
		const map = new THREE.DataTexture(new Uint8Array([40, 80, 40, 255]), 1, 1);
		const lacquer = createNaturalBodyLacquerMaterial();
		lacquer.map = map;
		lacquer.color.setHex(0xffffff);
		lacquer.userData.lacquerLifted = true;
		lacquer.userData.naturalAlbedo = true;
		lacquer.name = "paint_body";
		const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lacquer);
		body.name = "body";
		root.add(body);
		applyPaintToCar(root, "crimson", "blue");
		const mat = body.material as THREE.MeshStandardMaterial;
		expect(mat.map).not.toBeNull();
		expect(mat.userData.naturalAlbedo).toBe(true);
		expect(mat.color.getHex()).not.toBe(TEAM_BODY_PAINT.blue);
	});

	it("achromatic black paint lightly tints toward team — not solid blob", () => {
		setPaintCatalogForTests({
			schemaVersion: 1,
			paints: [
				{
					id: "black",
					nameKey: "paint.black",
					hex: "0x111111",
					accentHex: "0x000000",
					rarity: "common",
					finish: "standard",
				},
			],
		});
		const root = makeBodyRoot();
		applyPaintToCar(root, "black", "orange");
		const mat = (root.getObjectByName("body") as THREE.Mesh)
			.material as THREE.MeshStandardMaterial;
		expect(isReadableBodyLacquer(mat)).toBe(true);
		expect(mat.color.getHex()).not.toBe(TEAM_BODY_PAINT.orange);
		expect(mat.color.getHex()).not.toBe(TEAM_BODY_PAINT.blue);
		expect(colorLuma(mat.color.getHex())).toBeGreaterThanOrEqual(
			MIN_BODY_PAINT_LUMA,
		);
	});

	it("applyBodyLacquerToMaterial clears dark Trellis maps", () => {
		const mat = new THREE.MeshStandardMaterial({
			color: 0x050505,
			metalness: 1,
			map: new THREE.DataTexture(new Uint8Array([5, 5, 5, 255]), 1, 1),
		});
		applyBodyLacquerToMaterial(mat, TEAM_BODY_PAINT.blue);
		expect(isReadableBodyLacquer(mat)).toBe(true);
		expect(mat.userData.naturalAlbedo).toBeFalsy();
		mat.dispose();
	});
});
