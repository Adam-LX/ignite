import { describe, expect, it } from "vitest";

import {
	effectiveRanked,
	RANKED_UI_ENABLED,
} from "../../src/net/rankedFeature";

describe("rankedFeature", () => {
	it("RANKED_UI_ENABLED jest włączone (M4)", () => {
		expect(RANKED_UI_ENABLED).toBe(true);
	});

	it("effectiveRanked przepuszcza ranked gdy UI włączone", () => {
		expect(effectiveRanked(true)).toBe(true);
		expect(effectiveRanked(false)).toBe(false);
	});
});
