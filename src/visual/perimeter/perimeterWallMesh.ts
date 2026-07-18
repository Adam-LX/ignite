import * as THREE from "three";

import { RAMP_TOP_Y } from "./constants";
import { isGoalMouthSegment, outerAt } from "./ribbon";
import type { RibbonVertex } from "./types";

/**
 * Ciągła ściana z pętli ribbon — jeden wspólny wierzchołek na narożnik,
 * bez szczelin między segmentami (stare boxy na segment miały luki w narożach).
 */
export function buildPerimeterWallGeometry(
	ribbon: RibbonVertex[],
	height: number,
): THREE.BufferGeometry {
	const n = ribbon.length;
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const botIdx = new Array<number>(n);
	const topIdx = new Array<number>(n);

	for (let i = 0; i < n; i++) {
		const o = outerAt(ribbon[i]);
		botIdx[i] = positions.length / 3;
		positions.push(o.x, RAMP_TOP_Y, o.z);
		uvs.push(i, 0);
		topIdx[i] = positions.length / 3;
		positions.push(o.x, height, o.z);
		uvs.push(i, 1);
	}

	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		if (isGoalMouthSegment(ribbon[i], ribbon[j])) continue;
		const a = botIdx[i];
		const b = botIdx[j];
		const c = topIdx[j];
		const d = topIdx[i];
		indices.push(a, b, c, a, c, d);
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geo.setIndex(indices);
	geo.computeVertexNormals();
	return geo;
}
