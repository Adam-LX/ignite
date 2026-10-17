import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
	resolve(__dirname, "../../src/audio/GameAudio.ts"),
	"utf8",
);

describe("boost pad pickup audio", () => {
	it("spatial atten + thump dla small i big", () => {
		const i = src.indexOf("playBoostPadPickup(point");
		expect(i).toBeGreaterThan(0);
		const slice = src.slice(i, i + 2800);
		expect(slice).toContain("distAtten");
		expect(slice).toContain("playBodyThump(big ? 0.42 : 0.14, point)");
		expect(slice).toContain("getWorldPosition");
	});
});
