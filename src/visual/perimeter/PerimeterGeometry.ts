import * as THREE from "three";

import { neonTeamBandMaterial } from "../neonWallMaterial";

import {
	RAMP_BASE_Y,
	RAMP_CURVE_STEPS,
	rampCurveHeight,
	rampCurveRun,
} from "./constants";
import {
	auditGoalRampSymmetry,
	buildPerimeterRibbonLoop,
	isGoalMouthSegment,
	isGoalPostVertex,
} from "./ribbon";
import { buildPerimeterSegments } from "./segments";
import type { PerimeterSegment, RibbonMeshData, RibbonVertex } from "./types";

function pushTri(indices: number[], a: number, b: number, c: number): void {
	indices.push(a, b, c);
}

/** Ciągła wstęga ramp 3D — profil eliptycznej ćwiartki (łagodniejszy wjazd). */
export class PerimeterGeometry {
	/** Carbon band + hex szwy — blue/orange. */
	get rampMaterials(): readonly [
		THREE.ShaderMaterial,
		THREE.ShaderMaterial,
	] {
		return [neonTeamBandMaterial("blue"), neonTeamBandMaterial("orange")];
	}

	ensureBumpMaps(): void {
		/* Hex shader — bez bump map (skala z siatki). */
	}

	buildRibbon(segments: PerimeterSegment[]): RibbonVertex[] {
		const ribbon = buildPerimeterRibbonLoop(segments);
		const audit = auditGoalRampSymmetry(ribbon);
		if (!audit.ok) {
			for (const err of audit.errors) console.error(err);
			throw new Error(
				`PerimeterGeometry symmetry audit failed: ${audit.errors.join("; ")}`,
			);
		}
		return ribbon;
	}

	buildFromEdges(): {
		segments: PerimeterSegment[];
		ribbon: RibbonVertex[];
		mesh: RibbonMeshData;
	} {
		const segments = buildPerimeterSegments();
		const ribbon = this.buildRibbon(segments);
		return { segments, ribbon, mesh: this.buildRampMesh(ribbon) };
	}

	buildRampMesh(ribbon: RibbonVertex[]): RibbonMeshData {
		const n = ribbon.length;
		const steps = RAMP_CURVE_STEPS;
		const ringSize = steps + 1;
		const positions: number[] = [];
		const ringIdx: number[][] = Array.from({ length: n }, () => []);

		for (let i = 0; i < n; i++) {
			const v = ribbon[i]!;
			for (let s = 0; s < ringSize; s++) {
				const t = s / steps;
				const y = rampCurveHeight(t);
				const run = rampCurveRun(t);
				ringIdx[i]![s] = positions.length / 3;
				positions.push(v.x + v.outX * run, RAMP_BASE_Y + y, v.z + v.outZ * run);
			}
		}

		const ibIdx = ringIdx.map((ring) => ring[0]!);
		const otIdx = ringIdx.map((ring) => ring[steps]!);

		const blueTris: number[] = [];
		const orangeTris: number[] = [];

		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n;
			if (isGoalMouthSegment(ribbon[i]!, ribbon[j]!)) continue;

			const midZ = (ribbon[i]!.z + ribbon[j]!.z) * 0.5;
			const tris = midZ < 0 ? blueTris : orangeTris;

			for (let s = 0; s < steps; s++) {
				const a = ringIdx[i]![s]!;
				const b = ringIdx[j]![s]!;
				const c = ringIdx[j]![s + 1]!;
				const d = ringIdx[i]![s + 1]!;
				pushTri(tris, a, b, c);
				pushTri(tris, a, c, d);
			}
		}

		for (let i = 0; i < n; i++) {
			const prev = (i - 1 + n) % n;
			const next = (i + 1) % n;
			const prevMouth = isGoalMouthSegment(ribbon[prev]!, ribbon[i]!);
			const nextMouth = isGoalMouthSegment(ribbon[i]!, ribbon[next]);
			const atPost = isGoalPostVertex(ribbon[i]!.x, ribbon[i]!.z);
			const tris = ribbon[i]!.z < 0 ? blueTris : orangeTris;

			if (atPost) {
				if (!prevMouth) pushTri(tris, ibIdx[i]!, otIdx[prev]!, otIdx[i]!);
				if (!nextMouth) pushTri(tris, ibIdx[i]!, otIdx[i]!, otIdx[next]!);
				continue;
			}

			if (prevMouth || nextMouth) continue;

			const seamDot =
				ribbon[prev]!.outX * ribbon[i]!.outX +
				ribbon[prev]!.outZ * ribbon[i]!.outZ;
			if (seamDot > 0.999) continue;

			pushTri(tris, ibIdx[i]!, otIdx[prev]!, otIdx[i]!);
			pushTri(tris, ibIdx[i]!, otIdx[i]!, otIdx[next]!);
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
}

export const perimeterGeometry = new PerimeterGeometry();
