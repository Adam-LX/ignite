import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../../src/style.css"), "utf8");

describe("cam-indicator pause/settings hide", () => {
	it("gasi Ball Cam badge przy pause i settings (poza #hud)", () => {
		expect(css).toMatch(
			/body:has\(#game-container\.game-paused\)\s+#cam-indicator/,
		);
		expect(css).toContain("body.settings-open #cam-indicator");
		expect(css).toMatch(
			/body:has\(#game-container\.game-paused\)\s+#match-ping/,
		);
		expect(css).toContain("body.settings-open #match-ping");
	});

	it("free-cam / active mają opacity 1 (czytelne w meczu)", () => {
		expect(css).toMatch(/#cam-indicator\.free-cam\s*\{[^}]*opacity:\s*1/);
		expect(css).toMatch(/#cam-indicator\.active\s*\{[^}]*opacity:\s*1/);
	});
});
