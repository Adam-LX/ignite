import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("realtime RT stack contracts", () => {
	it("ArenaRtProxy does not create geometry", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/pathTracing/ArenaRtProxy.ts"),
			"utf8",
		);
		expect(src).toContain("disposeArenaRtProxy");
		expect(src).not.toContain("BoxGeometry");
	});

	it("gpuRealtimeRt defaults off in prefs", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/util/presentationPrefs.ts"),
			"utf8",
		);
		expect(src).toMatch(/gpuRealtimeRt:\s*false/);
		expect(src).toMatch(/pathTraceLook:\s*true/);
	});
});
