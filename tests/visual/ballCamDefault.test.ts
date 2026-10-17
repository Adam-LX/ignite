import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rendererSrc = readFileSync(
	resolve(__dirname, "../../src/Renderer.ts"),
	"utf8",
);

describe("Renderer ball-cam defaults", () => {
	it("starts in Ball Cam (pro default ~80–90% of match)", () => {
		expect(rendererSrc).toMatch(/private isBallCam\s*=\s*true/);
		expect(rendererSrc).toMatch(/private ballCamBlendT\s*=\s*1/);
	});

	it("przywraca Ball Cam po podium (stash + restore)", () => {
		const sessionSrc = readFileSync(
			resolve(__dirname, "../../src/game/GameSession.ts"),
			"utf8",
		);
		expect(sessionSrc).toContain("ballCamBeforePodium");
		expect(sessionSrc).toContain("enterPodiumBallCam");
		expect(sessionSrc).toContain("restoreBallCamAfterPodium");
		expect(sessionSrc).toMatch(
			/phase === "playing"[\s\S]{0,120}restoreBallCamAfterPodium/,
		);
	});
});
