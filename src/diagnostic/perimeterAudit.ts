import {
	type ArenaPerimeterEdge,
	getArenaPerimeterEdges,
	RL_ARENA,
} from "../visual/arenaConstants";
import {
	buildPerimeterRibbonLoop,
	buildPerimeterSegments,
	type PerimeterEdge,
	type PerimeterSegment,
} from "../visual/perimeter";

const CLOSURE_EPS = 0.1;
const GOAL_GAP_EPS = 0.15;

export type PerimeterAuditResult = {
	ok: boolean;
	errors: string[];
	warnings: string[];
};

type RibbonPoint = { x: number; z: number };

function edgeLength(e: ArenaPerimeterEdge): number {
	return Math.hypot(e.bx - e.ax, e.bz - e.az);
}

function isOnGoalLine(z: number): boolean {
	return Math.abs(Math.abs(z) - RL_ARENA.HALF_LENGTH) < 0.25;
}

/** Segment krawędzi w całości w świetle bramki — bez rampy. */
function isGoalCutEdge(e: ArenaPerimeterEdge): boolean {
	const gw = RL_ARENA.GOAL_WIDTH / 2;
	if (
		!isOnGoalLine(e.az) ||
		!isOnGoalLine(e.bz) ||
		Math.abs(e.az - e.bz) > 0.25
	) {
		return false;
	}
	const minX = Math.min(e.ax, e.bx);
	const maxX = Math.max(e.ax, e.bx);
	return minX >= -gw && maxX <= gw;
}

function isExpectedGoalGap(
	a: ArenaPerimeterEdge,
	b: ArenaPerimeterEdge,
): boolean {
	const gw = RL_ARENA.GOAL_WIDTH / 2;
	if (
		!isOnGoalLine(a.bz) ||
		!isOnGoalLine(b.az) ||
		Math.abs(a.bz - b.az) > 0.25
	) {
		return false;
	}
	const gap = Math.hypot(a.bx - b.ax, a.bz - b.az);
	if (Math.abs(gap - RL_ARENA.GOAL_WIDTH) > 0.2) return false;
	return (
		(Math.abs(a.bx + gw) < GOAL_GAP_EPS &&
			Math.abs(b.ax - gw) < GOAL_GAP_EPS) ||
		(Math.abs(a.bx - gw) < GOAL_GAP_EPS && Math.abs(b.ax + gw) < GOAL_GAP_EPS)
	);
}

function mirrorEdge(e: ArenaPerimeterEdge): ArenaPerimeterEdge {
	return { ax: -e.bx, az: e.bz, bx: -e.ax, bz: e.az };
}

function auditEdgeSymmetry(
	edges: ArenaPerimeterEdge[],
	errors: string[],
): void {
	const gw = RL_ARENA.GOAL_WIDTH / 2;
	const hw = RL_ARENA.HALF_WIDTH;
	const cc = RL_ARENA.CORNER_CUT;

	const findEndSegment = (z: number, side: "neg" | "pos") => {
		const corner = side === "neg" ? -hw + cc : hw - cc;
		const post = side === "neg" ? -gw : gw;
		return edges.find((e) => {
			if (Math.abs(e.az - z) > 0.25 || Math.abs(e.bz - z) > 0.25) return false;
			const xs = [e.ax, e.bx];
			return (
				xs.some((x) => Math.abs(x - corner) < 0.05) &&
				xs.some((x) => Math.abs(x - post) < 0.05)
			);
		});
	};

	const endpointsMatch = (
		a: ArenaPerimeterEdge,
		b: ArenaPerimeterEdge,
	): boolean => {
		const ptsA = [
			`${a.ax.toFixed(2)},${a.az}`,
			`${a.bx.toFixed(2)},${a.bz}`,
		].sort();
		const ptsB = [
			`${b.ax.toFixed(2)},${b.az}`,
			`${b.bx.toFixed(2)},${b.bz}`,
		].sort();
		return ptsA.every((p, i) => p === ptsB[i]);
	};

	for (const z of [-RL_ARENA.HALF_LENGTH, RL_ARENA.HALF_LENGTH] as const) {
		const negSeg = findEndSegment(z, "neg");
		const posSeg = findEndSegment(z, "pos");
		if (!negSeg || !posSeg) {
			errors.push(
				`[AUDIT_ERROR] Brak symetrycznych segmentów bramki przy z=${z} (±X).`,
			);
			continue;
		}
		if (!endpointsMatch(negSeg, mirrorEdge(posSeg))) {
			errors.push(
				`[AUDIT_ERROR] Asymetria bramki przy z=${z}: lewy ≠ mirror(prawy).`,
			);
		}
	}

	console.log("[ARENA AUDIT] Symetria bramek ±X: OK");
}

function isGoalMouthRibbonEdge(a: RibbonPoint, b: RibbonPoint): boolean {
	const gw = RL_ARENA.GOAL_WIDTH / 2;
	if (!isOnGoalLine(a.z) || !isOnGoalLine(b.z) || Math.abs(a.z - b.z) > 0.25) {
		return false;
	}
	const minX = Math.min(a.x, b.x);
	const maxX = Math.max(a.x, b.x);
	return minX >= -gw && maxX <= gw;
}

/** Wspólna pętla wierzchołków rampy — identyczna dla mesh / neonów / cieni. */
export function getPerimeterRibbonLoop(
	segments: PerimeterSegment[] = buildPerimeterSegments(),
): RibbonPoint[] {
	return buildPerimeterRibbonLoop(segments);
}

function auditRibbonLoop(
	ribbon: RibbonPoint[],
	errors: string[],
	warnings: string[],
): void {
	console.log("[ARENA AUDIT] === Ribbon Render Loop ===");

	for (let i = 0; i < ribbon.length; i++) {
		const j = (i + 1) % ribbon.length;
		const a = ribbon[i];
		const b = ribbon[j];
		const len = Math.hypot(b.x - a.x, b.z - a.z);
		const cut = isGoalMouthRibbonEdge(a, b);
		const hasRamp = !cut;
		const reason = cut ? "GoalCut" : "Normal";

		console.log(
			`[ARENA AUDIT] Ribbon INDEX: ${i} | Start: (${a.x.toFixed(2)}, ${a.z.toFixed(2)}) -> End: (${b.x.toFixed(2)}, ${b.z.toFixed(2)}) | Length: ${len.toFixed(2)} | HasRamp: ${hasRamp ? "YES" : "NO"} | Reason: ${reason}`,
		);

		if (len > CLOSURE_EPS && !hasRamp && len < RL_ARENA.GOAL_WIDTH - 0.5) {
			warnings.push(
				`Ribbon ${i}: GoalCut o długości ${len.toFixed(2)}m (oczekiwane ~${RL_ARENA.GOAL_WIDTH}m).`,
			);
		}
	}

	const first = ribbon[0];
	const last = ribbon[ribbon.length - 1];
	const closingEdgeLen = Math.hypot(first.x - last.x, first.z - last.z);
	const closingIsRamp = !isGoalMouthRibbonEdge(last, first);
	if (closingEdgeLen > CLOSURE_EPS && !closingIsRamp) {
		errors.push(
			`[AUDIT_ERROR] Pętla ribbon: zamykająca krawędź GoalCut (${closingEdgeLen.toFixed(2)}m).`,
		);
	} else if (closingEdgeLen <= CLOSURE_EPS) {
		console.log(
			`[ARENA AUDIT] Pętla ribbon zamknięta (wierzchołek współdzielony).`,
		);
	} else {
		console.log(
			`[ARENA AUDIT] Pętla ribbon zamknięta (krawędź ${closingEdgeLen.toFixed(2)}m, HasRamp: YES).`,
		);
	}

	const gw = RL_ARENA.GOAL_WIDTH / 2;
	const hl = RL_ARENA.HALF_LENGTH;
	for (const zSign of [-1, 1] as const) {
		const z = zSign * hl;
		const leftPost = ribbon.find(
			(v) => Math.abs(v.x + gw) < 0.05 && Math.abs(v.z - z) < 0.05,
		);
		const rightPost = ribbon.find(
			(v) => Math.abs(v.x - gw) < 0.05 && Math.abs(v.z - z) < 0.05,
		);
		if (!leftPost || !rightPost) {
			errors.push(
				`[AUDIT_ERROR] Brak wierzchołków słupków bramki przy z=${z}.`,
			);
			continue;
		}

		const cornerX = -RL_ARENA.HALF_WIDTH + RL_ARENA.CORNER_CUT;
		const hasRampBesidePost = (postX: number) =>
			ribbon.some((_v, i) => {
				const j = (i + 1) % ribbon.length;
				const a = ribbon[i];
				const b = ribbon[j];
				if (isGoalMouthRibbonEdge(a, b)) return false;
				if (Math.abs(a.z - z) > 0.1 || Math.abs(b.z - z) > 0.1) return false;
				const minX = Math.min(a.x, b.x);
				const maxX = Math.max(a.x, b.x);
				if (postX < 0) {
					return (
						Math.abs(minX - cornerX) < 0.15 &&
						Math.abs(maxX - postX) < 0.15 &&
						maxX - minX > 1
					);
				}
				return (
					Math.abs(minX - postX) < 0.15 &&
					Math.abs(maxX - -cornerX) < 0.15 &&
					maxX - minX > 1
				);
			});

		const leftRamp = hasRampBesidePost(-gw);
		const rightRamp = hasRampBesidePost(gw);

		if (!leftRamp) {
			errors.push(
				`[AUDIT_ERROR] Brak rampy po LEWEJ stronie bramki (z=${z}) — dziura w klatce!`,
			);
		}
		if (!rightRamp) {
			errors.push(
				`[AUDIT_ERROR] Brak rampy po PRAWEJ stronie bramki (z=${z}).`,
			);
		}
		if (leftRamp && rightRamp) {
			console.log(`[ARENA AUDIT] Bramka z=${z}: rampy lewa+prawa OK`);
		}
	}
}

export function runPerimeterAudit(
	edges: ArenaPerimeterEdge[] = getArenaPerimeterEdges(),
): PerimeterAuditResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	console.log("[ARENA AUDIT] === Perimeter Edge Report ===");

	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		const len = edgeLength(e);
		const cut = isGoalCutEdge(e);
		const hasRamp = !cut;
		const reason = cut ? "GoalCut" : "Normal";

		console.log(
			`[ARENA AUDIT] Segment INDEX: ${i} | Start: (${e.ax}, ${e.az}) -> End: (${e.bx}, ${e.bz}) | Length: ${len.toFixed(2)} | HasRamp: ${hasRamp ? "YES" : "NO"} | Reason: ${reason}`,
		);
	}

	let unexpectedGaps = 0;
	for (let i = 0; i < edges.length; i++) {
		const next = edges[(i + 1) % edges.length];
		const gap = Math.hypot(edges[i].bx - next.ax, edges[i].bz - next.az);
		if (gap <= CLOSURE_EPS) continue;

		if (isExpectedGoalGap(edges[i], next)) {
			console.log(
				`[ARENA AUDIT] Otwór bramkowy ${i}->${(i + 1) % edges.length}: gap=${gap.toFixed(2)}m (OK)`,
			);
			continue;
		}

		unexpectedGaps++;
		errors.push(
			`[AUDIT_ERROR] Obwód klatki nie jest zamknięty! Wykryto dziurę! Segment ${i} end -> ${(i + 1) % edges.length} start gap=${gap.toFixed(3)}m`,
		);
	}

	if (unexpectedGaps === 0) {
		console.log(
			"[ARENA AUDIT] Obwód krawędzi: zamknięty (tylko oczekiwane otwory bramkowe).",
		);
	}

	auditEdgeSymmetry(edges, errors);

	const segments = buildPerimeterSegments(edges as PerimeterEdge[]);
	const ribbon = getPerimeterRibbonLoop(segments);
	auditRibbonLoop(ribbon, errors, warnings);

	if (errors.length === 0) {
		console.log(
			"[ARENA AUDIT] PASS — obwód zamknięty, symetria bramek OK, rampy po obu stronach.",
		);
	} else {
		for (const err of errors) console.error(err);
	}

	for (const w of warnings) console.warn(w);

	return { ok: errors.length === 0, errors, warnings };
}
