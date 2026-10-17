import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
	AUDIO_PATHS,
	countdownTickPath,
} from "../../src/audio/AudioManifest";

describe("premium SFX pack", () => {
	it("countdownTickPath mapuje 5→1 na osobne sample", () => {
		expect(countdownTickPath(5)).toBe(AUDIO_PATHS.countdown5);
		expect(countdownTickPath(3)).toBe(AUDIO_PATHS.countdown3);
		expect(countdownTickPath(1)).toBe(AUDIO_PATHS.countdown1);
		expect(countdownTickPath(0)).toBe(AUDIO_PATHS.countdown1);
	});

	it("pliki premium istnieją na dysku (silnik nietknięty)", () => {
		const root = resolve(__dirname, "../../public/assets/audio/sfx");
		for (const name of [
			"countdown_1.ogg",
			"countdown_5.ogg",
			"countdown_go.ogg",
			"kickoff.ogg",
			"demolish.ogg",
			"boost_pad.ogg",
			"goal_crowd.ogg",
			"engine_low.wav",
			"engine_high.wav",
		]) {
			expect(existsSync(resolve(root, name)), name).toBe(true);
		}
	});
});
