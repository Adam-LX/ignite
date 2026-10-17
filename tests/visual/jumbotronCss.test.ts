import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
	resolve(__dirname, "../../src/style.css"),
	"utf8",
);

describe("jumbotron CSS contracts", () => {
	it("chrome mask covers YT title/pause chrome overlays", () => {
		expect(css).toContain(".jumbotron-chrome-mask");
		expect(css).toMatch(/jumbotron-chrome-mask[\s\S]{0,400}linear-gradient/);
		expect(css).toMatch(/jumbotron-yt[\s\S]{0,120}filter:/);
	});

	it("layer is non-interactive (stadium overlay)", () => {
		expect(css).toMatch(
			/\.jumbotron-layer\s*\{[^}]*pointer-events:\s*none/,
		);
	});

	it("scanlines + IGNITE bug nad chrome-mask (z-index)", () => {
		const maskZ = css.match(
			/\.jumbotron-chrome-mask\s*\{[^}]*z-index:\s*(\d+)/,
		)?.[1];
		const scanZ = css.match(
			/\.jumbotron-scan\s*\{[^}]*z-index:\s*(\d+)/,
		)?.[1];
		const bugZ = css.match(
			/\.jumbotron-bug\s*\{[^}]*z-index:\s*(\d+)/,
		)?.[1];
		expect(maskZ).toBeTruthy();
		expect(scanZ).toBeTruthy();
		expect(bugZ).toBeTruthy();
		expect(Number(scanZ)).toBeGreaterThan(Number(maskZ));
		expect(Number(bugZ)).toBeGreaterThan(Number(scanZ));
		expect(css).toMatch(/\.jumbotron-scan\s*\{[^}]*repeating-linear-gradient/);
		expect(css).toMatch(/\.jumbotron-bug\s*\{[^}]*letter-spacing/);
	});
});
