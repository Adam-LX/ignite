import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	buildArenaGrassShape,
	buildPlayfieldFloorTrimesh,
} from "../../src/visual/arena";
import {
	getArenaPerimeterEdges,
	RL_ARENA,
} from "../../src/visual/arenaConstants";
import { perimeterGeometry } from "../../src/visual/perimeter/PerimeterGeometry";
import { rampCurveHeight, rampCurveRun } from "../../src/visual/perimeter/constants";

describe("arena perimeter + goals", () => {
	it("murawa ma przerwę na otwór bramkowy (bez ciągu przez środek)", () => {
		const gw = RL_ARENA.GOAL_WIDTH / 2;
		const shape = buildArenaGrassShape();
		const pts = shape.getPoints();
		const onBlueGoalLine = pts.filter(
			(p) => Math.abs(p.y - RL_ARENA.HALF_LENGTH) < 0.05,
		);
		const insideMouth = onBlueGoalLine.filter((p) => Math.abs(p.x) < gw - 0.2);
		expect(insideMouth.length).toBe(0);
	});

	it("wielokąt murawy mieści się w wymiarach RL (bez PITCH_BLEED)", () => {
		const { positions } = buildPlayfieldFloorTrimesh();
		let maxAbsX = 0;
		let maxAbsZ = 0;
		for (let i = 0; i < positions.length; i += 3) {
			maxAbsX = Math.max(maxAbsX, Math.abs(positions[i]!));
			maxAbsZ = Math.max(maxAbsZ, Math.abs(positions[i + 2]!));
		}
		expect(maxAbsX).toBeLessThanOrEqual(RL_ARENA.HALF_WIDTH + 0.05);
		expect(maxAbsZ).toBeLessThanOrEqual(RL_ARENA.HALF_LENGTH + 0.05);
	});

	it("profil rampy — quarter-pipe (poziomy start, pionowy koniec)", () => {
		expect(rampCurveHeight(0)).toBeCloseTo(0);
		expect(rampCurveRun(0)).toBeCloseTo(0);
		expect(rampCurveHeight(1)).toBeCloseTo(rampCurveRun(1), 5);
		/** t≈0: więcej run niż height (styczna pozioma). */
		expect(rampCurveRun(0.2)).toBeGreaterThan(rampCurveHeight(0.2));
		/** t≈1: height dogania run (styczna pionowa). */
		expect(rampCurveHeight(0.8)).toBeGreaterThan(rampCurveRun(0.8) * 0.55);
		/** Nie prosta 45° — mid-curve height ≠ run. */
		expect(Math.abs(rampCurveHeight(0.5) - rampCurveRun(0.5))).toBeGreaterThan(
			0.15 * rampCurveRun(1),
		);
	});

	it("PerimeterGeometry buduje rampę bez błędu audytu", () => {
		const { mesh } = perimeterGeometry.buildFromEdges();
		expect(mesh.positions.length).toBeGreaterThan(0);
		expect(mesh.indices.length).toBeGreaterThan(0);
	});
});

describe("buildArenaGrassShape gap handling", () => {
	it("moveTo przy skoku bramkowym", () => {
		const edges = getArenaPerimeterEdges();
		const shape = buildArenaGrassShape(edges);
		const geo = new THREE.ShapeGeometry(shape);
		const pos = geo.getAttribute("position") as THREE.BufferAttribute;
		let hasMouthChord = false;
		const gw = RL_ARENA.GOAL_WIDTH / 2;
		const hl = RL_ARENA.HALF_LENGTH;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const y = pos.getY(i);
			if (Math.abs(y - hl) < 0.08 && Math.abs(x) < gw - 0.15) {
				hasMouthChord = true;
				break;
			}
		}
		geo.dispose();
		expect(hasMouthChord).toBe(false);
	});
});
