import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	applyShockwaveDemoImpulse,
	getTraitsForBodyStyle,
	getTraitsForCar,
	pivotDodgeDeadzone,
	ramHitImpulseScale,
} from "../../src/meta/carBodyTraits";
import { FALLBACK_CATALOG } from "../../src/meta/CarCatalog";

describe("carBodyTraits", () => {
	it("maps bodyStyle to distinct hooks", () => {
		expect(getTraitsForBodyStyle("wide").hook).toBe("ramHit");
		expect(getTraitsForBodyStyle("low").hook).toBe("aeroSnap");
		expect(getTraitsForBodyStyle("hatch").hook).toBe("pivotBoost");
		expect(getTraitsForBodyStyle("tall").hook).toBe("shockwaveDemo");
		expect(getTraitsForBodyStyle("standard").hook).toBe("none");
	});

	it("resolves traits from catalog carId without hardcoding", () => {
		const wideCar = FALLBACK_CATALOG.cars.find((c) => c.bodyStyle === "wide");
		const lowCar = FALLBACK_CATALOG.cars.find((c) => c.bodyStyle === "low");
		expect(wideCar).toBeTruthy();
		expect(lowCar).toBeTruthy();
		expect(getTraitsForCar(wideCar!.id).hook).toBe("ramHit");
		expect(getTraitsForCar(lowCar!.id).hook).toBe("aeroSnap");
		expect(getTraitsForCar(wideCar!.id).ramHitImpulseMul).not.toBe(
			getTraitsForCar(lowCar!.id).ramHitImpulseMul,
		);
	});

	it("RamHit scales only frontal mid-speed hits", () => {
		const wide = getTraitsForBodyStyle("wide");
		expect(ramHitImpulseScale(wide, 0.9, 800)).toBeCloseTo(1.08);
		expect(ramHitImpulseScale(wide, 0.4, 800)).toBe(1);
		expect(ramHitImpulseScale(wide, 0.9, 1400)).toBe(1);
		expect(ramHitImpulseScale(getTraitsForBodyStyle("low"), 0.9, 800)).toBe(1);
	});

	it("PivotBoost lowers dodge deadzone under speed cap", () => {
		const hatch = getTraitsForBodyStyle("hatch");
		expect(pivotDodgeDeadzone(hatch, 0.2, 500)).toBeCloseTo(0.17);
		expect(pivotDodgeDeadzone(hatch, 0.2, 1000)).toBe(0.2);
	});

	it("ShockwaveDemo knocks nearby cars, skips attacker", () => {
		const tall = getTraitsForBodyStyle("tall");
		const impulses: number[] = [];
		const makeCar = (x: number) => ({
			getPosition: () => ({ x, y: 0.4, z: 0 }),
			rapierRigidBody: {
				mass: () => 180,
				applyImpulse: (imp: { x: number; y: number; z: number }) => {
					impulses.push(Math.hypot(imp.x, imp.y, imp.z));
				},
			},
		});
		const attacker = makeCar(0);
		const near = makeCar(3);
		const far = makeCar(40);
		const epicenter = new THREE.Vector3(0, 0.4, 0);
		const hits = applyShockwaveDemoImpulse(
			[attacker, near, far],
			epicenter,
			tall,
			attacker,
		);
		expect(hits).toBe(1);
		expect(impulses).toHaveLength(1);
		expect(impulses[0]!).toBeGreaterThan(0);
	});
});
