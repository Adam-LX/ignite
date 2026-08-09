import { describe, expect, it } from "vitest";

import {
	demoAllowsMode,
	demoMatchDurationSec,
	resolveDemoLimits,
} from "../../src/game/demoBuild";

describe("demoBuild", () => {
	it("off by default — full duration and modes", () => {
		expect(resolveDemoLimits().enabled).toBe(false);
		expect(demoMatchDurationSec(300)).toBe(300);
		expect(demoAllowsMode("2v2")).toBe(true);
	});
});
