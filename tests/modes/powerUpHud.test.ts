import { describe, expect, it } from "vitest";

import { IgnitionManager } from "../../src/modes/IgnitionManager";

describe("IgnitionManager HUD", () => {
	it("starts disabled when manager is off", () => {
		const mgr = new IgnitionManager(false);
		mgr.registerSlot(0);
		const hud = mgr.getHudState(0);
		expect(hud.enabled).toBe(false);
		expect(hud.held).toBeNull();
	});

	it("assigns held power-up after pick timer", () => {
		const mgr = new IgnitionManager(true);
		mgr.registerSlot(1);
		const ball = {
			getPosition: () => ({ x: 0, y: 1, z: 0 }),
			rapierRigidBody: { applyImpulse: () => {}, setTranslation: () => {}, setLinvel: () => {}, setAngvel: () => {} },
		} as never;
		mgr.bindBall(ball);
		const cars = [
			{
				slotIndex: 1,
				player: {
					getPosition: () => ({ x: 0, y: 0, z: 0 }),
					getForward: () => ({ x: 0, y: 0, z: 1 }),
					getUpward: () => ({ x: 0, y: 1, z: 0 }),
				},
			},
		] as never[];

		mgr.update(6, cars, ball, false);

		expect(mgr.getHeldPowerUp(1)).not.toBeNull();
	});
});
