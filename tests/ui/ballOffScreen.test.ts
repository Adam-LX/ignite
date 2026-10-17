import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
	resolve(__dirname, "../../src/ui/BallOffScreenIndicator.ts"),
	"utf8",
);
const css = readFileSync(resolve(__dirname, "../../src/style.css"), "utf8");

describe("BallOffScreenIndicator contracts", () => {
	it("hides under Ball Cam and only tracks Free Cam off-screen", () => {
		expect(src).toContain("ballCamEnabled");
		expect(src).toMatch(/if\s*\(\s*ballCamEnabled\s*\)\s*\{[\s\S]{0,80}this\.hide\(\)/);
		expect(src).toContain("NDC_MARGIN");
		expect(css).toContain("#ball-offscreen");
	});
});
