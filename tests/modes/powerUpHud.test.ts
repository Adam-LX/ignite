import { describe, expect, it } from "vitest";

import { IgnitionManager, ignitionPickIntervalSec } from "../../src/modes/IgnitionManager";
import { shouldShowPowerUpWorld } from "../../src/visual/powerUpVisuals";

describe("IgnitionManager HUD", () => {
	it("starts disabled when manager is off", () => {
		const mgr = new IgnitionManager(false);
		mgr.registerSlot(0);
		const hud = mgr.getHudState(0);
		expect(hud.enabled).toBe(false);
		expect(hud.held).toBeNull();
	});

	it("assigns held power-up per slot after individual pick timer", () => {
		const mgr = new IgnitionManager(true);
		mgr.registerSlot(0);
		const ball = {
			getPosition: () => ({ x: 0, y: 1, z: 0 }),
			rapierRigidBody: {
				applyImpulse: () => {},
				linvel: () => ({ x: 0, y: 0, z: 0 }),
				setTranslation: () => {},
				setLinvel: () => {},
				setAngvel: () => {},
			},
		} as never;
		mgr.bindBall(ball);
		const cars = [
			{
				slotIndex: 0,
				player: {
					getPosition: () => ({ x: 0, y: 0, z: 0 }),
					getForward: () => ({ x: 0, y: 0, z: 1 }),
					getUpward: () => ({ x: 0, y: 1, z: 0 }),
				},
			},
		] as never[];

		mgr.update(8, cars, ball, false);

		expect(mgr.getHeldPowerUp(0)).not.toBeNull();
	});

	it("unregistered slots never receive power-ups (Ignition Test pattern)", () => {
		const mgr = new IgnitionManager(true);
		mgr.registerSlot(0);
		const ball = {
			getPosition: () => ({ x: 0, y: 1, z: 0 }),
			rapierRigidBody: {
				applyImpulse: () => {},
				linvel: () => ({ x: 0, y: 0, z: 0 }),
				setTranslation: () => {},
				setLinvel: () => {},
				setAngvel: () => {},
			},
		} as never;
		mgr.bindBall(ball);
		const cars = [
			{
				slotIndex: 0,
				player: {
					getPosition: () => ({ x: 0, y: 0, z: 0 }),
					getForward: () => ({ x: 0, y: 0, z: 1 }),
					getUpward: () => ({ x: 0, y: 1, z: 0 }),
				},
			},
			{
				slotIndex: 1,
				player: {
					getPosition: () => ({ x: 5, y: 0, z: 0 }),
					getForward: () => ({ x: 0, y: 0, z: 1 }),
					getUpward: () => ({ x: 0, y: 1, z: 0 }),
				},
			},
		] as never[];

		mgr.update(12, cars, ball, false);

		expect(mgr.getHeldPowerUp(0)).not.toBeNull();
		expect(mgr.getHeldPowerUp(1)).toBeNull();
		expect(mgr.getHudState(1).pickSecondsLeft).toBe(
			ignitionPickIntervalSec(1),
		);
	});
});

describe("power-up world VFX", () => {
	it("does not show world FX for held magnet before activation", () => {
		expect(
			shouldShowPowerUpWorld({
				enabled: true,
				held: "magnet",
				pickProgress: 1,
				pickSecondsLeft: 0,
				activeKind: null,
				activeProgress: 0,
				activeSecondsLeft: 0,
			}),
		).toBe(false);
	});

	it("shows world FX when magnet is active", () => {
		expect(
			shouldShowPowerUpWorld({
				enabled: true,
				held: null,
				pickProgress: 0,
				pickSecondsLeft: 10,
				activeKind: "magnet",
				activeProgress: 0.8,
				activeSecondsLeft: 4,
			}),
		).toBe(true);
	});
});
