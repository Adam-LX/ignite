import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
	resolve(__dirname, "../../src/physics/RocketCar.ts"),
	"utf8",
);

describe("soft landing preserves flip residual", () => {
	it("applySoftLanding: flipActive return + pitchLock spin guard", () => {
		const i = src.indexOf("private applySoftLanding()");
		expect(i).toBeGreaterThan(0);
		const slice = src.slice(i, i + 2800);
		expect(slice).toMatch(/if\s*\(\s*this\.flipActive\s*\)\s*\{\s*return;/);
		expect(slice).toContain("if (this.flipPitchLockLeft > 0)");
		expect(slice).toContain("if (spin > 1.15) return");
	});

	it("turtle stand nie zeruje całkowicie ω", () => {
		expect(src).toContain("ang.x * 0.22");
		expect(src).toContain("ang.y * 0.35");
		expect(src).toContain("ang.z * 0.22");
	});
});
