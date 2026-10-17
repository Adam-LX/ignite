import * as THREE from "three";

import { RAMP_TOP_Y } from "./constants";
import { isGoalMouthSegment, outerAt } from "./ribbon";
import type { RibbonMeshData, RibbonVertex } from "./types";

/**
 * Ciągła ściana z pętli ribbon — jeden wspólny wierzchołek na narożnik,
 * bez szczelin między segmentami (stare boxy na segment miały luki w narożach).
 * @param outwardExtra — dodatkowe wysunięcie wzdłuż out.
 */
export function buildPerimeterWallGeometry(
	ribbon: RibbonVertex[],
	height: number,
	outwardExtra = 0,
): THREE.BufferGeometry {
	const n = ribbon.length;
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const botIdx = new Array<number>(n);
	const topIdx = new Array<number>(n);

	for (let i = 0; i < n; i++) {
		const v = ribbon[i]!;
		const o = outerAt(v);
		const x = o.x + v.outX * outwardExtra;
		const z = o.z + v.outZ * outwardExtra;
		botIdx[i] = positions.length / 3;
		positions.push(x, RAMP_TOP_Y, z);
		uvs.push(i, 0);
		topIdx[i] = positions.length / 3;
		positions.push(x, height, z);
		uvs.push(i, 1);
	}

	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		if (isGoalMouthSegment(ribbon[i]!, ribbon[j]!)) continue;
		const a = botIdx[i]!;
		const b = botIdx[j]!;
		const c = topIdx[j]!;
		const d = topIdx[i]!;
		indices.push(a, b, c, a, c, d);
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geo.setIndex(indices);
	geo.computeVertexNormals();
	return geo;
}

/**
 * Niski pas bandy nad rampą — nieprzezroczysty, kolor blue/orange jak rampa.
 * Maskuje skybox przy grazingu bez czarnych pełnych ścian.
 */
export function buildPerimeterBandSkirt(
	ribbon: RibbonVertex[],
	skirtHeight = 2.35,
	outwardExtra = 0.04,
): RibbonMeshData {
	const n = ribbon.length;
	const y0 = RAMP_TOP_Y;
	const y1 = RAMP_TOP_Y + skirtHeight;
	const positions: number[] = [];
	const botIdx = new Array<number>(n);
	const topIdx = new Array<number>(n);

	for (let i = 0; i < n; i++) {
		const v = ribbon[i]!;
		const o = outerAt(v);
		const x = o.x + v.outX * outwardExtra;
		const z = o.z + v.outZ * outwardExtra;
		botIdx[i] = positions.length / 3;
		positions.push(x, y0, z);
		topIdx[i] = positions.length / 3;
		positions.push(x, y1, z);
	}

	const blueTris: number[] = [];
	const orangeTris: number[] = [];

	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		if (isGoalMouthSegment(ribbon[i]!, ribbon[j]!)) continue;
		const midZ = (ribbon[i]!.z + ribbon[j]!.z) * 0.5;
		const tris = midZ < 0 ? blueTris : orangeTris;
		const a = botIdx[i]!;
		const b = botIdx[j]!;
		const c = topIdx[j]!;
		const d = topIdx[i]!;
		tris.push(a, b, c, a, c, d);
	}

	const blueCount = blueTris.length;
	return {
		positions: new Float32Array(positions),
		indices: new Uint32Array([...blueTris, ...orangeTris]),
		groups: [
			{ start: 0, count: blueCount, materialIndex: 0 },
			{ start: blueCount, count: orangeTris.length, materialIndex: 1 },
		],
	};
}
