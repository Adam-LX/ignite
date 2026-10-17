import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("real GPU path tracer stack", () => {
	it("MatchPathTracer używa WebGLPathTracer (legacy module)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/pathTracing/MatchPathTracer.ts"),
			"utf8",
		);
		expect(src).toContain("three-gpu-pathtracer");
		expect(src).toContain("WebGLPathTracer");
	});

	it("Renderer używa IgniteRtDirector", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/Renderer.ts"),
			"utf8",
		);
		expect(src).toContain("IgniteRtDirector");
		expect(src).toContain("prepareAndMaybeRenderRt");
		expect(src).toContain("premiumPost.render");
	});

	it("package.json ma three-realtime-rt i three-gpu-pathtracer", () => {
		const pkg = JSON.parse(
			readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
		) as { dependencies?: Record<string, string> };
		expect(pkg.dependencies?.["three-gpu-pathtracer"]).toBeTruthy();
		expect(pkg.dependencies?.["three-realtime-rt"]).toBeTruthy();
	});
});
