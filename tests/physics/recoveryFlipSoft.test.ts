import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
	resolve(__dirname, "../../src/physics/RocketCar.ts"),
	"utf8",
);

describe("recovery flip soft autoflip", () => {
	it("blenduje residual ω zamiast hard-set", () => {
		const i = src.indexOf("private performGroundRecoveryFlip");
		expect(i).toBeGreaterThan(0);
		const slice = src.slice(i, i + 1600);
		expect(slice).toContain("prev.x * 0.18");
		expect(slice).toMatch(/rate\s*=\s*7\.2\s*\+\s*tilt\s*\*\s*4\.2/);
	});
});
