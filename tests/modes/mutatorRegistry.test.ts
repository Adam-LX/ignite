import { describe, expect, it } from "vitest";

import {
	getWeeklyMutator,
	isoWeekKey,
	mutatorIndexForWeek,
	resolveMutatorTickEffects,
	type WeeklyMutatorsCatalog,
} from "../../src/modes/MutatorRegistry";

const FIXTURE: WeeklyMutatorsCatalog = {
	schemaVersion: 1,
	mutators: [
		{
			id: "a",
			nameKey: "mutator.a",
			descKey: "mutator.a.d",
			effects: { boostRegenMul: 2 },
		},
		{
			id: "b",
			nameKey: "mutator.b",
			descKey: "mutator.b.d",
			effects: { carGravityMul: 0.5 },
		},
		{
			id: "c",
			nameKey: "mutator.c",
			descKey: "mutator.c.d",
			effects: { ballSpeedMul: 1.2 },
		},
	],
};

describe("MutatorRegistry", () => {
	it("isoWeekKey is stable for a fixed UTC date", () => {
		expect(isoWeekKey(new Date("2026-07-16T12:00:00Z"))).toBe("2026-W29");
	});

	it("mutatorIndexForWeek is deterministic", () => {
		const a = mutatorIndexForWeek("2026-W29", 7);
		const b = mutatorIndexForWeek("2026-W29", 7);
		expect(a).toBe(b);
		expect(a).toBeGreaterThanOrEqual(0);
		expect(a).toBeLessThan(7);
	});

	it("same week → same mutator for all clients", () => {
		const date = new Date("2026-07-16T18:00:00Z");
		const m1 = getWeeklyMutator(date, FIXTURE);
		const m2 = getWeeklyMutator(date, FIXTURE);
		expect(m1.id).toBe(m2.id);
	});

	it("resolveMutatorTickEffects fills defaults", () => {
		expect(resolveMutatorTickEffects({})).toEqual({
			ballSpeedMul: 1,
			carGravityMul: 1,
			boostRegenMul: 1,
			boostForceMul: 1,
		});
		expect(resolveMutatorTickEffects({ boostRegenMul: 2 }).boostRegenMul).toBe(
			2,
		);
	});
});
