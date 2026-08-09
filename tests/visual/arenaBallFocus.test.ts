import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
	getArenaBallFocus,
	pulseArenaBallFocus,
} from "../../src/visual/arenaBallFocus";

describe("arenaBallFocus", () => {
	it("pulseArenaBallFocus — blend rośnie i maleje", () => {
		pulseArenaBallFocus(new THREE.Vector3(2, 1, -4), 0.9, 0.5);
		expect(getArenaBallFocus().blend).toBeGreaterThan(0.5);
	});
});
