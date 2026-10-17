import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { BoostPadManager } from "../../src/arena/BoostPadManager";
import { modeHasPowerUps } from "../../src/game/modes";

describe("M3.5 Arena Alive", () => {
	it("modeHasPowerUps — tylko Ignition FFA", () => {
		expect(modeHasPowerUps("1v1")).toBe(false);
		expect(modeHasPowerUps("2v2")).toBe(false);
		expect(modeHasPowerUps("ignitionRush2v2")).toBe(false);
		expect(modeHasPowerUps("ignition")).toBe(true);
		expect(modeHasPowerUps("ignition1v1")).toBe(true);
	});

	it("BoostPadManager — pickup i cooldown", () => {
		const mgr = new BoostPadManager([
			{
				x: 0,
				z: 0,
				amount: 0.12,
				radius: 2,
				respawnSec: 4,
				big: false,
			},
		]);
		const pos = new THREE.Vector3(0, 0.5, 0);
		let fuel = 0;
		let picks = 0;
		const player = {
			getPosition: () => pos,
			addBoostFuel: (n: number) => {
				fuel += n;
			},
		};
		mgr.onPickup(() => {
			picks += 1;
		});
		mgr.update(0.016, [player as never]);
		expect(fuel).toBeCloseTo(0.12);
		expect(picks).toBe(1);
		mgr.update(0.016, [player as never]);
		expect(picks).toBe(1);
		expect(mgr.getPadStates()[0]!.active).toBe(false);
	});
});
