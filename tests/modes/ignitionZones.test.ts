import { describe, expect, it } from "vitest";

import {
	IgnitionZonesController,
	pickIgnitionZoneLayout,
} from "../../src/modes/IgnitionZones";

function fakeCar(slot: number, x: number, z: number, y = 0.4) {
	return {
		slotIndex: slot,
		player: {
			getPosition: () => ({ x, y, z }),
			gravityScale: 1,
		},
	};
}

describe("pickIgnitionZoneLayout", () => {
	it("returns exactly two zones of different kinds", () => {
		const zones = pickIgnitionZoneLayout(42);
		expect(zones).toHaveLength(2);
		const kinds = new Set(zones.map((z) => z.kind));
		expect(kinds.has("lowGrav")).toBe(true);
		expect(kinds.has("magnetic")).toBe(true);
	});
});

describe("IgnitionZonesController relocate", () => {
	it("buff only while inside; leave relocates zone", () => {
		const z = new IgnitionZonesController(true, 3);
		const zone = z.zones[0]!;
		const car = fakeCar(0, zone.x, zone.z);

		z.update(0.016, [car as never], null, true);
		expect(z.getBuff(0)?.kind).toBe(zone.kind);
		expect(z.consumeLayoutDirty()).toBe(false);

		const before = { x: zone.x, z: zone.z };
		car.player.getPosition = () => ({ x: before.x + 40, y: 0.4, z: before.z });
		z.update(0.016, [car as never], null, true);

		expect(z.getBuff(0)).toBeNull();
		expect(z.consumeLayoutDirty()).toBe(true);
		const relocated = z.zones.find((s) => s.id === zone.id)!;
		expect(
			Math.hypot(relocated.x - before.x, relocated.z - before.z),
		).toBeGreaterThan(2);
	});

	it("leave does not relocate while another car remains inside", () => {
		const z = new IgnitionZonesController(true, 3);
		const zone = z.zones[0]!;
		const a = fakeCar(0, zone.x, zone.z);
		const b = fakeCar(1, zone.x + 0.4, zone.z);

		z.update(0.016, [a as never, b as never], null, true);
		expect(z.getBuff(0)?.kind).toBe(zone.kind);
		expect(z.getBuff(1)?.kind).toBe(zone.kind);

		const before = { x: zone.x, z: zone.z };
		a.player.getPosition = () => ({ x: before.x + 40, y: 0.4, z: before.z });
		z.update(0.016, [a as never, b as never], null, true);

		expect(z.getBuff(0)).toBeNull();
		expect(z.getBuff(1)?.kind).toBe(zone.kind);
		expect(z.consumeLayoutDirty()).toBe(false);
		expect(z.zones.find((s) => s.id === zone.id)!.x).toBeCloseTo(before.x, 5);
	});

	it("disabled controller has no zones", () => {
		const z = new IgnitionZonesController(false);
		expect(z.zones).toHaveLength(0);
	});
});
