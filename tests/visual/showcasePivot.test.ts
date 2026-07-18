import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	resolveShowcasePivotY,
	resolveShowcasePivotYStable,
} from "../../src/visual/carWheelGround";

function makeAsymmetricHero(): THREE.Group {
	const heroPivot = new THREE.Group();
	heroPivot.name = "menuHeroCar";
	const spin = new THREE.Group();
	spin.name = "menuHeroSpin";
	const display = new THREE.Group();
	display.name = "octaneCarDisplay";
	const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.2));
	body.name = "body";
	body.position.x = 0.35;
	display.add(body);
	spin.add(display);
	heroPivot.add(spin);
	return heroPivot;
}

describe("showcase pivot stability", () => {
	it("pivot Y zależy od skali — przeliczamy tylko gdy scale się zmieni", () => {
		const hero = makeAsymmetricHero();
		const display = hero.getObjectByName("octaneCarDisplay")!;
		display.scale.setScalar(2);
		const y2 = resolveShowcasePivotYStable(hero, display);
		display.scale.setScalar(2.08);
		const y208 = resolveShowcasePivotYStable(hero, display);
		expect(Math.abs(y208 - y2)).toBeGreaterThan(0.01);
	});

	it("resolveShowcasePivotYStable — ten sam Y przy obrocie spin", () => {
		const hero = makeAsymmetricHero();
		const display = hero.getObjectByName("octaneCarDisplay")!;
		const spin = hero.getObjectByName("menuHeroSpin") as THREE.Group;
		const y0 = resolveShowcasePivotYStable(hero, display);
		spin.rotation.y = Math.PI / 2;
		hero.updateMatrixWorld(true);
		const y90 = resolveShowcasePivotYStable(hero, display);
		expect(y90).toBeCloseTo(y0, 5);
	});
});
