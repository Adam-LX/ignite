import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { PowerUpActivationVfx } from "../../src/visual/vfx/powerUpActivationVfx";

describe("PowerUpActivationVfx", () => {
	it("trigger + update kończy burst", () => {
		const scene = new THREE.Scene();
		const vfx = new PowerUpActivationVfx(scene);
		vfx.trigger(
			"haymaker",
			new THREE.Vector3(0, 1, 0),
			new THREE.Vector3(0, 0, 1),
		);
		expect(scene.children.some((c) => c.visible)).toBe(true);
		for (let i = 0; i < 30; i++) vfx.update(1 / 60);
		expect(scene.children.every((c) => !c.visible)).toBe(true);
		vfx.dispose();
	});
});

describe("IgnitionManager onActivate", () => {
	it("emituje event przy aktywacji magnetu", async () => {
		const { IgnitionManager } = await import("../../src/modes/IgnitionManager");
		const mgr = new IgnitionManager(true);
		mgr.registerSlot(0);
		mgr.forceHeldForTests(0, "magnet");
		const ball = {
			getPosition: () => ({ x: 0, y: 0.92, z: 0 }),
			rapierRigidBody: {
				applyImpulse: () => {},
				linvel: () => ({ x: 0, y: 0, z: 0 }),
				setTranslation: () => {},
				setLinvel: () => {},
				setAngvel: () => {},
			},
		} as never;
		mgr.bindBall(ball);

		let fired = false;
		mgr.onActivate((e) => {
			fired = true;
			expect(e.kind).toBe("magnet");
			expect(e.position.y).toBeGreaterThan(0);
		});

		const player = {
			getPosition: () => new THREE.Vector3(0, 0, 0),
			getForward: () => new THREE.Vector3(0, 0, 1),
			getUpward: () => new THREE.Vector3(0, 1, 0),
		} as never;

		expect(mgr.tryHumanActivate(0, player, "blue", false)).toBe(true);
		expect(fired).toBe(true);
	});
});
