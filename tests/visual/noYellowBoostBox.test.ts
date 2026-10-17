import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("no yellow boost box", () => {
	it("CarAfterimageVfx: zero BoxGeometry; OFF przy boost", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/vfx/carAfterimageVfx.ts"),
			"utf8",
		);
		expect(src).not.toContain("new THREE.BoxGeometry");
		expect(src).toContain("if (boosting)");
		expect(src).toContain("hideAll");
		expect(src).toContain("PlaneGeometry");
	});

	it("CarStreakVfx: SphereGeometry zamiast boxa", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/vfx/carStreakVfx.ts"),
			"utf8",
		);
		expect(src).not.toContain("new THREE.BoxGeometry");
		expect(src).toContain("SphereGeometry");
	});

	it("BoostExhaustVfx: tylko Points, bez volume mesh", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/vfx/boostExhaustVfx.ts"),
			"utf8",
		);
		expect(src).not.toContain("new THREE.BoxGeometry");
		expect(src).not.toContain("CylinderGeometry");
		expect(src).toContain("boostExhaustFlame");
	});
});
