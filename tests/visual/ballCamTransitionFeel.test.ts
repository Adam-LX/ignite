import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	tickBallCamBlendT,
	tickBallCamFraming,
} from "../../src/visual/cameraFollow";
import { RL_CAMERA } from "../../src/util/rlConstants";

describe("Ball Cam transition feel (pro ~1.3)", () => {
	it("transitionSpeed w paśmie pro 1.0–1.5", () => {
		expect(RL_CAMERA.transitionSpeed).toBeGreaterThanOrEqual(1.0);
		expect(RL_CAMERA.transitionSpeed).toBeLessThanOrEqual(1.5);
	});

	it("blend nie skacze >0.25 w jednej klatce 60Hz", () => {
		let t = 0;
		const dt = 1 / 60;
		let maxStep = 0;
		for (let i = 0; i < 90; i++) {
			const next = tickBallCamBlendT(t, true, dt);
			maxStep = Math.max(maxStep, Math.abs(next - t));
			t = next;
		}
		expect(maxStep).toBeLessThan(0.25);
		expect(t).toBeGreaterThan(0.98);
	});

	it("framing hysteresis: stay Ball w martwej strefie 0.42–0.58", () => {
		expect(tickBallCamFraming(false, 0.5)).toBe(false);
		expect(tickBallCamFraming(false, 0.58)).toBe(true);
		expect(tickBallCamFraming(true, 0.5)).toBe(true);
		expect(tickBallCamFraming(true, 0.42)).toBe(false);
	});

	it("setBallCamEnabled nie snapuje blendT (soft ease)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/Renderer.ts"),
			"utf8",
		);
		const i = src.indexOf("setBallCamEnabled(enabled: boolean)");
		expect(i).toBeGreaterThan(0);
		const slice = src.slice(i, i + 280);
		expect(slice).not.toMatch(/ballCamBlendT\s*=\s*Math\.max/);
		expect(slice).not.toMatch(/ballCamBlendT\s*=\s*Math\.min/);
	});
});
