import { describe, expect, it } from "vitest";

import { buildRlKickoffSpawns } from "../../src/game/rlKickoffSpawns";

describe("rlKickoffSpawns", () => {
	it("2v2 — blue ally ma nazwę Kael i center_back", () => {
		const spawns = buildRlKickoffSpawns("2v2", 0.65);
		const human = spawns.find((s) => s.displayName === "You");
		const ally = spawns.find((s) => s.displayName === "Kael");
		expect(human?.spawnRole).toBe("offensive_corner");
		expect(ally?.team).toBe("blue");
		expect(ally?.spawnRole).toBe("center_back");
	});

	it("2v2 — orange boty mają własne nazwy, nie Kael", () => {
		const spawns = buildRlKickoffSpawns("2v2", 0.65);
		const orange = spawns.filter((s) => s.team === "orange");
		expect(orange.every((s) => s.displayName !== "Kael")).toBe(true);
		expect(orange.some((s) => s.displayName === "Zara")).toBe(true);
		expect(orange.some((s) => s.spawnRole === "center_back")).toBe(true);
	});

	it("1v1 / 2v2 — corner kickoff jest diagonalny (przeciwne znaki X)", () => {
		const one = buildRlKickoffSpawns("1v1", 0.65);
		const blue = one.find((s) => s.team === "blue")!;
		const orange = one.find((s) => s.team === "orange")!;
		expect(Math.sign(blue.position.x)).not.toBe(Math.sign(orange.position.x));

		const two = buildRlKickoffSpawns("2v2", 0.65);
		const blueCorner = two.find(
			(s) => s.team === "blue" && s.spawnRole === "offensive_corner",
		)!;
		const orangeCorner = two.find(
			(s) => s.team === "orange" && s.spawnRole === "offensive_corner",
		)!;
		expect(Math.sign(blueCorner.position.x)).not.toBe(
			Math.sign(orangeCorner.position.x),
		);
	});
});
