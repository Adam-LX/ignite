import * as THREE from "three";

import { flatRampShadowMaterial } from "../materials";

import { SHADOW_RENDER_ORDER, SHADOW_WIDTH, SHADOW_Y } from "./constants";
import { isGoalMouthSegment } from "./ribbon";
import type { RibbonMeshData, RibbonVertex } from "./types";

function pushTri(indices: number[], a: number, b: number, c: number): void {
	indices.push(a, b, c);
}

function appendFlatShadowStrip(
	positions: number[],
	indices: number[],
	a: RibbonVertex,
	b: RibbonVertex,
): void {
	const base = positions.length / 3;
	const ax = a.x - a.outX * SHADOW_WIDTH;
	const az = a.z - a.outZ * SHADOW_WIDTH;
	const bx = b.x - b.outX * SHADOW_WIDTH;
	const bz = b.z - b.outZ * SHADOW_WIDTH;

	positions.push(
		a.x,
		SHADOW_Y,
		a.z,
		b.x,
		SHADOW_Y,
		b.z,
		bx,
		SHADOW_Y,
		bz,
		ax,
		SHADOW_Y,
		az,
	);
	pushTri(indices, base, base + 1, base + 2);
	pushTri(indices, base, base + 2, base + 3);
}

/** Subtelny, rozmyty cień AO pod dolną krawędzią rampy (MultiplyBlending na murawie). */
export class PerimeterShadows {
	buildMeshData(ribbon: RibbonVertex[]): RibbonMeshData {
		const positions: number[] = [];
		const indices: number[] = [];
		const n = ribbon.length;

		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n;
			if (isGoalMouthSegment(ribbon[i], ribbon[j])) continue;
			appendFlatShadowStrip(positions, indices, ribbon[i], ribbon[j]);
		}

		return {
			positions: new Float32Array(positions),
			indices: new Uint32Array(indices),
			groups: [],
		};
	}

	addToGroup(parent: THREE.Group, ribbon: RibbonVertex[]): void {
		const data = this.buildMeshData(ribbon);
		if (data.indices.length === 0) return;

		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
		geo.setIndex(new THREE.BufferAttribute(data.indices, 1));

		const mesh = new THREE.Mesh(geo, flatRampShadowMaterial());
		mesh.name = "rampContactShadow";
		mesh.renderOrder = SHADOW_RENDER_ORDER;
		mesh.frustumCulled = false;
		parent.add(mesh);
	}
}

export const perimeterShadows = new PerimeterShadows();
