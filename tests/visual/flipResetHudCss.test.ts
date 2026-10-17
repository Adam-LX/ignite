import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../../src/style.css"), "utf8");

describe("flip reset HUD cue", () => {
	it("has dedicated moment flash + banner styling", () => {
		expect(css).toContain('data-moment="flip_reset"');
		expect(css).toMatch(
			/#match-moment-flash\[data-moment="flip_reset"\]/,
		);
		expect(css).toMatch(
			/#match-moment-banner\[data-moment="flip_reset"\]/,
		);
	});
});
