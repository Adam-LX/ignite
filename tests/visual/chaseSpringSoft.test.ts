import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("chase spring soft (pro stiffness feel)", () => {
	it("aerial/ball/car smooth times ≥0.06; lookSmoothHz ≤13", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/cameraFollow.ts"),
			"utf8",
		);
		expect(src).toMatch(/posSmoothTimeAerial:\s*0\.065/);
		expect(src).toMatch(/posSmoothTimeBall:\s*0\.075/);
		expect(src).toMatch(/lookSmoothHz:\s*12/);
	});
});
