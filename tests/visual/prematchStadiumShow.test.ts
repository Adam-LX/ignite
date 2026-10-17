import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("prematch stadium show contracts", () => {
	it("IGNITE ARENA arc: dłuższy show, balkon, drop cues", () => {
		const src = readFileSync(
			resolve(
				__dirname,
				"../../src/visual/preMatchShow/PreMatchStadiumShow.ts",
			),
			"utf8",
		);
		expect(src).toMatch(/SHOW_DURATION_SEC\s*=\s*24/);
		expect(src).toContain("PHASE_FLYOVER");
		expect(src).toMatch(/PHASE_FLYOVER\s*=\s*0\.4/);
		expect(src).toContain("CUE_DROP");
		expect(src).toContain("startPrematchTranceBed");
		expect(src).toContain("stopPrematchTranceBed");
		expect(src).toContain("smoke.burst");
		expect(src).toContain("setGoalDotMatrixPrematchCue");
		expect(src).toMatch(/exposureOffset:\s*-0\./);
		expect(src).toContain("setPrematchLaserBlackout");
		expect(src).toContain("prematch-show__title--slam");
		expect(src).toContain("dataset.phase");
		expect(src).toContain("Hero side cam");
		expect(src).toContain("Crane flyover");
		expect(src).toContain("playStadiumShowRiser");
		expect(src).toContain("hazeQualityScale");
		expect(src).toContain("HERO DROP");
		expect(src).toContain("prematch.phase.");
		expect(src).toContain("phaseLabelEl");
		expect(src).toContain("startPrematchTranceBed");
	});

	it("lasery: choreografia przestrzenna + chromatic RGB", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/preMatchShow/StadiumLaserRig.ts"),
			"utf8",
		);
		expect(src).toContain("Dash = akcent skanu");
		expect(src).toMatch(/uGain:\s*\{\s*value:\s*4\.2/);
		expect(src).toContain("Chromatic beam");
		expect(src).toContain("TEAM_BLUE");
		expect(src).toContain("TEAM_ORANGE");
		expect(src).toContain("nie midfield knot");
		expect(src).toContain("TEAM SPLIT");
		expect(src).toContain("LIQUID SKY");
		expect(src).toContain("kurtyny z BRAMEK");
		expect(src).not.toContain("wirujący tęczowy tunnel na midfield");
		expect(src).toMatch(/addProjector\([\s\S]*?,\s*3,/);
		expect(src).toContain("NormalBlending");
		expect(src).toContain("PHASE_ACCENT");
		expect(src).not.toMatch(/haze\.visible = false/);
	});

	it("trance scanners + bloom preserve-color", () => {
		const show = readFileSync(
			resolve(
				__dirname,
				"../../src/visual/preMatchShow/PreMatchStadiumShow.ts",
			),
			"utf8",
		);
		expect(show).toContain("StadiumTranceScanners");
		expect(show).toContain("StadiumShowFireworks");
		expect(show).toContain("pulseSpectacle");
		expect(show).toContain("getPrematchTrancePulse");
		expect(show).toContain("setLaserShowPreserveColor(true)");
		expect(show).toContain("beginTeardown");
		expect(show).toContain("yieldFrames");
		const sc = readFileSync(
			resolve(
				__dirname,
				"../../src/visual/preMatchShow/StadiumTranceScanners.ts",
			),
			"utf8",
		);
		expect(sc).toContain("stadiumTranceScanners");
		expect(sc).toContain("uColor");
		const optics = readFileSync(
			resolve(__dirname, "../../src/visual/optics/MatchOpticsDirector.ts"),
			"utf8",
		);
		expect(optics).toContain("setLaserShowPreserveColor");
		expect(optics).toContain("laserShowPreserveColor");
	});

	it("color wash: team split + liquid sky sheet", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/preMatchShow/StadiumColorWash.ts"),
			"utf8",
		);
		expect(src).toContain("stadiumColorWash");
		expect(src).toContain("uColorA");
		expect(src).toContain("liquid");
		const show = readFileSync(
			resolve(
				__dirname,
				"../../src/visual/preMatchShow/PreMatchStadiumShow.ts",
			),
			"utf8",
		);
		expect(show).toContain("StadiumColorWash");
		expect(show).toContain("this.wash.update");
		expect(show).toContain("staggered");
	});

	it("audio: procedural trance bed @ 138 BPM", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/audio/GameAudio.ts"),
			"utf8",
		);
		expect(src).toContain("PREMATCH_TRANCE_BPM = 138");
		expect(src).toContain("startPrematchTranceBed");
		expect(src).toContain("getPrematchTrancePulse");
	});
});
