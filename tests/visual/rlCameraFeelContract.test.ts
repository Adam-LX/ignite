import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { RL_CAMERA } from "../../src/util/rlConstants";
import {
	BASE_FOV,
	CAMERA_STIFFNESS,
	KICKOFF_CAM_DISTANCE,
	KICKOFF_CAM_HEIGHT,
	PLAYER_FRAME,
	WALL_CHASE_STIFFNESS_CAP,
	chaseSpeedAngleDeg,
	chaseSpeedStretchM,
	chaseStiffnessForSurface,
	createChaseCameraState,
	kickoffCamHeightForAspect,
	resetChaseCameraHeading,
	tickBallCamBlendT,
} from "../../src/visual/cameraFollow";

/**
 * RL reference (pro cam 2025–26):
 * FOV 110 · Distance ~270 · Height 90–110 · Angle −3…−5 · Stiffness 0.35–0.50
 * Camera shake off. Ultrawide keeps vFOV via horizontalFov compensation.
 */
describe("RL camera feel contracts", () => {
	it("matches pro FOV / distance / height / angle / stiffness band", () => {
		expect(RL_CAMERA.horizontalFov).toBe(110);
		expect(BASE_FOV).toBe(110);
		/* 1 uu = 1 cm → pro majority ~270/90 uu = 2.7/0.9 m */
		expect(RL_CAMERA.distance).toBeGreaterThanOrEqual(2.5);
		expect(RL_CAMERA.distance).toBeLessThanOrEqual(2.9);
		expect(RL_CAMERA.height).toBeGreaterThanOrEqual(0.9);
		expect(RL_CAMERA.height).toBeLessThanOrEqual(1.1);
		expect(RL_CAMERA.angleDeg).toBeLessThanOrEqual(-3);
		expect(RL_CAMERA.angleDeg).toBeGreaterThanOrEqual(-5);
		expect(CAMERA_STIFFNESS).toBeGreaterThanOrEqual(0.35);
		expect(CAMERA_STIFFNESS).toBeLessThanOrEqual(0.55);
		expect(RL_CAMERA.transitionSpeed).toBeGreaterThanOrEqual(1.0);
		expect(RL_CAMERA.transitionSpeed).toBeLessThanOrEqual(1.6);
		expect(RL_CAMERA.swivelSpeed).toBeGreaterThanOrEqual(4);
		expect(RL_CAMERA.swivelSpeed).toBeLessThanOrEqual(10);
	});

	it("speed stretch opens when stiffness softens", () => {
		const soft = chaseSpeedStretchM(1, 0.35);
		const stiff = chaseSpeedStretchM(1, 0.9);
		expect(soft).toBeGreaterThan(stiff);
		expect(chaseSpeedAngleDeg(1, 0.35)).toBeGreaterThan(
			chaseSpeedAngleDeg(1, 0.9),
		);
	});

	it("default chase state has no residual camera shake", () => {
		const state = createChaseCameraState();
		expect(state.shakeIntensity).toBe(0);
		expect(state.shakeApplied.lengthSq()).toBe(0);
	});

	it("ball cam blend reaches target within ~pro transition window", () => {
		let t = 0;
		const dt = 1 / 60;
		for (let i = 0; i < 90; i++) t = tickBallCamBlendT(t, true, dt);
		expect(t).toBeGreaterThan(0.98);
		for (let i = 0; i < 90; i++) t = tickBallCamBlendT(t, false, dt);
		expect(t).toBeLessThan(0.02);
	});

	it("resetChaseCameraHeading clears shake (demo/respawn snap)", () => {
		const state = createChaseCameraState();
		state.shakeIntensity = 0.8;
		state.shakeApplied.set(0.2, 0.1, -0.15);
		resetChaseCameraHeading(state, new THREE.Quaternion());
		expect(state.shakeIntensity).toBe(0);
		expect(state.shakeApplied.lengthSq()).toBe(0);
		expect(state.flipCamActive).toBe(false);
	});

	it("kickoff cam is taller/farther than live chase for approach reads", () => {
		expect(KICKOFF_CAM_DISTANCE).toBeGreaterThan(RL_CAMERA.distance);
		expect(KICKOFF_CAM_HEIGHT).toBeGreaterThan(RL_CAMERA.height);
		const h169 = kickoffCamHeightForAspect(16 / 9);
		const hUw = kickoffCamHeightForAspect(21 / 9);
		expect(hUw).toBeGreaterThanOrEqual(h169);
	});

	it("PLAYER_FRAME keeps car low in frame (Pan Kamil)", () => {
		expect(PLAYER_FRAME.preferY).toBeLessThan(0);
		expect(PLAYER_FRAME.preferY).toBeGreaterThan(-0.45);
		expect(PLAYER_FRAME.maxAbsX).toBeLessThanOrEqual(0.15);
		expect(PLAYER_FRAME.maxPitchDownDeg).toBeLessThanOrEqual(-12);
	});

	it("wall tilt uses softer heading damp than ground (wall dash reads)", () => {
		const camSrc = readFileSync(
			resolve(__dirname, "../../src/visual/cameraFollow.ts"),
			"utf8",
		);
		expect(CAMERA_STIFFNESS).toBeLessThanOrEqual(0.45);
		expect(camSrc).toMatch(
			/wallTilt[\s\S]{0,500}headingSmoothHz\s*\*\s*0\.4/,
		);
		expect(camSrc).toMatch(
			/wallTilt[\s\S]{0,500}headingMaxRadPerSec\s*\*\s*0\.28/,
		);
	});

	it("wall surface caps chase stiffness softer than ground", () => {
		expect(WALL_CHASE_STIFFNESS_CAP).toBeLessThan(CAMERA_STIFFNESS);
		expect(chaseStiffnessForSurface(false)).toBe(CAMERA_STIFFNESS);
		expect(chaseStiffnessForSurface(true)).toBe(WALL_CHASE_STIFFNESS_CAP);
		expect(chaseSpeedStretchM(1, WALL_CHASE_STIFFNESS_CAP)).toBeGreaterThan(
			chaseSpeedStretchM(1, CAMERA_STIFFNESS),
		);
	});
});
