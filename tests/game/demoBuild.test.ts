import { afterEach, describe, expect, it } from "vitest";

import {
	demoAllowsMode,
	demoMatchDurationSec,
	resolveDemoLimits,
} from "../../src/game/demoBuild";

describe("demoBuild", () => {
	afterEach(() => {
		delete process.env.IGNITE_DEMO;
	});

	it("off by default — full duration and modes", () => {
		expect(resolveDemoLimits().enabled).toBe(false);
		expect(demoMatchDurationSec(300)).toBe(300);
		expect(demoAllowsMode("2v2")).toBe(true);
	});

	it("demo playlist: Core 1v1+2v2, bez Experimental", () => {
		process.env.IGNITE_DEMO = "1";
		expect(resolveDemoLimits().enabled).toBe(true);
		expect(demoAllowsMode("1v1")).toBe(true);
		expect(demoAllowsMode("2v2")).toBe(true);
		expect(demoAllowsMode("ignitionRush2v2")).toBe(false);
		expect(demoMatchDurationSec(300)).toBe(300);
		expect(demoMatchDurationSec(900)).toBe(600);
	});
});
