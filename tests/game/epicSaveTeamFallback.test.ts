import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("GameSession epic save team fallback", () => {
	it("evaluateEpicSave dostaje team ?? visualTeam", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/game/GameSession.ts"),
			"utf8",
		);
		expect(src).toMatch(
			/epicSaveTeam\s*=\s*this\.humanCar\.team\s*\?\?\s*this\.humanCar\.visualTeam/,
		);
		expect(src).toMatch(/evaluateEpicSave\(\s*epicSaveTeam/);
	});
});
