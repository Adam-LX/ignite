import { RL_ARENA } from "../arenaConstants";

import { RAMP_RUN } from "./constants";
import type { PerimeterSegment, RibbonVertex } from "./types";

const RIBBON_EPS = 0.01;

/** Pomijamy wyłącznie odcinek w całości w świetle bramki [-gw, +gw] na linii końcowej. */
export function isGoalMouthSegment(a: RibbonVertex, b: RibbonVertex): boolean {
	const hl = RL_ARENA.HALF_LENGTH;
	const gw = RL_ARENA.GOAL_WIDTH / 2;
	if (Math.abs(a.z - b.z) > 0.25) return false;
	if (Math.abs(Math.abs(a.z) - hl) > 0.25) return false;
	if (Math.abs(Math.abs(b.z) - hl) > 0.25) return false;
	const minX = Math.min(a.x, b.x);
	const maxX = Math.max(a.x, b.x);
	return minX >= -gw && maxX <= gw;
}

export function isGoalPostVertex(x: number, z: number): boolean {
	const hl = RL_ARENA.HALF_LENGTH;
	const gw = RL_ARENA.GOAL_WIDTH / 2;
	return Math.abs(Math.abs(z) - hl) < 0.5 && Math.abs(Math.abs(x) - gw) < 0.5;
}

export function outerAt(v: RibbonVertex): { x: number; z: number } {
	return { x: v.x + v.outX * v.run, z: v.z + v.outZ * v.run };
}

function outwardAtCorner(
	segments: PerimeterSegment[],
	segIdx: number,
): { outX: number; outZ: number } {
	const n = segments.length;
	const prev = segments[(segIdx - 1 + n) % n];
	const seg = segments[segIdx];
	const outX = prev.outX + seg.outX;
	const outZ = prev.outZ + seg.outZ;
	const len = Math.hypot(outX, outZ) || 1;
	return { outX: outX / len, outZ: outZ / len };
}

function makeRibbonVertex(
	x: number,
	z: number,
	segments: PerimeterSegment[],
	segIdx: number,
): RibbonVertex {
	const { outX, outZ } = outwardAtCorner(segments, segIdx);
	return { x, z, outX, outZ, run: RAMP_RUN };
}

/**
 * Zamknięta pętla wierzchołków — każdy segment kończy się na bx/bz;
 * przy otworze bramki dodawany jest słupek przed skokiem na drugą stronę.
 */
export function buildPerimeterRibbonLoop(
	segments: PerimeterSegment[],
): RibbonVertex[] {
	const n = segments.length;
	const ribbon: RibbonVertex[] = [];

	for (let i = 0; i < n; i++) {
		const seg = segments[i];
		const next = segments[(i + 1) % n];

		const push = (x: number, z: number) => {
			const last = ribbon[ribbon.length - 1];
			if (last && Math.hypot(last.x - x, last.z - z) < RIBBON_EPS) return;
			ribbon.push(makeRibbonVertex(x, z, segments, i));
		};

		push(seg.ax, seg.az);
		if (Math.hypot(seg.bx - next.ax, seg.bz - next.az) > RIBBON_EPS) {
			push(seg.bx, seg.bz);
		}
	}

	return ribbon;
}

export type GoalSymmetryAudit = {
	ok: boolean;
	errors: string[];
	leftRampLen: number;
	rightRampLen: number;
};

/**
 * Weryfikuje symetrię ±X wokół obu bramek — długości ramp lewa/prawa muszą się zgadzać.
 */
export function auditGoalRampSymmetry(
	ribbon: RibbonVertex[],
): GoalSymmetryAudit {
	const hl = RL_ARENA.HALF_LENGTH;
	const gw = RL_ARENA.GOAL_WIDTH / 2;
	const cornerX = RL_ARENA.HALF_WIDTH - RL_ARENA.CORNER_CUT;
	const errors: string[] = [];
	let allOk = true;

	for (const zSign of [-1, 1] as const) {
		const z = zSign * hl;
		let leftLen = 0;
		let rightLen = 0;

		for (let i = 0; i < ribbon.length; i++) {
			const j = (i + 1) % ribbon.length;
			const a = ribbon[i];
			const b = ribbon[j];
			if (isGoalMouthSegment(a, b)) continue;
			if (Math.abs(a.z - z) > 0.1 || Math.abs(b.z - z) > 0.1) continue;

			const len = Math.hypot(b.x - a.x, b.z - a.z);
			const minAbsX = Math.min(Math.abs(a.x), Math.abs(b.x));
			const maxAbsX = Math.max(Math.abs(a.x), Math.abs(b.x));

			if (
				Math.abs(maxAbsX - cornerX) < 0.15 &&
				Math.abs(minAbsX - gw) < 0.15 &&
				len > 1
			) {
				if (Math.max(a.x, b.x) < 0) leftLen = len;
				else rightLen = len;
			}
		}

		if (leftLen < 0.5) {
			errors.push(
				`[PerimeterGeometry] Brak lewej bandy przy bramce z=${z} (X<0).`,
			);
			allOk = false;
		}
		if (rightLen < 0.5) {
			errors.push(
				`[PerimeterGeometry] Brak prawej bandy przy bramce z=${z} (X>0).`,
			);
			allOk = false;
		}
		if (
			leftLen > 0.5 &&
			rightLen > 0.5 &&
			Math.abs(leftLen - rightLen) > 0.15
		) {
			errors.push(
				`[PerimeterGeometry] Asymetria bramki z=${z}: lewa=${leftLen.toFixed(2)}m ≠ prawa=${rightLen.toFixed(2)}m`,
			);
			allOk = false;
		}
	}

	return { ok: allOk, errors, leftRampLen: 0, rightRampLen: 0 };
}
