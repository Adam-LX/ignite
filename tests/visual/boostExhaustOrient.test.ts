import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("boost exhaust — particle flame (no yellow box)", () => {
	it("nie używa CylinderGeometry / PlaneGeometry / softTrail mesh", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/vfx/boostExhaustVfx.ts"),
			"utf8",
		);
		expect(src).not.toContain("CylinderGeometry");
		expect(src).not.toContain("PlaneGeometry");
		expect(src).not.toContain("jetCross");
		expect(src).not.toContain("createSoftTrailMaterial");
		expect(src).toContain("boostExhaustFlame");
		expect(src).toContain("THREE.Points");
		expect(src).toContain("multiplyScalar(-1)");
	});
});
