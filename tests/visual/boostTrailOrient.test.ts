import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { BoostTrail } from "../../src/visual/vfx/boostTrail";

vi.mock("../../src/meta/CosmeticCatalog", () => ({
	getTrailEntry: () => ({ id: "default" }),
}));
vi.mock("../../src/meta/PlayerInventory", () => ({
	getEquippedPaintId: () => "none",
	getEquippedTrailId: () => "default",
}));
vi.mock("../../src/visual/applyPaintCosmetic", () => ({
	applyPaintToTrailColors: () => ({
		head: new THREE.Color(0xffffff),
		core: new THREE.Color(0xffffaa),
		mid: new THREE.Color(0xff8800),
		tail: new THREE.Color(0xff0044),
	}),
}));

function stubPlayer(opts: {
	pos: THREE.Vector3;
	forward: THREE.Vector3;
	up: THREE.Vector3;
	grounded: boolean;
	vel?: THREE.Vector3;
}) {
	return {
		getPosition: () => opts.pos.clone(),
		getVelocity: () => (opts.vel ?? new THREE.Vector3(0, 0, 12)).clone(),
		getForward: () => opts.forward.clone(),
		getUpward: () => opts.up.clone(),
		isOnGround: () => opts.grounded,
	};
}

describe("BoostTrail orientation", () => {
	it("w powietrzu jedna wstęga wzdłuż lotu (nie pionowe karty)", () => {
		const scene = new THREE.Scene();
		const trail = new BoostTrail(scene);
		const pos = new THREE.Vector3(0, 4, 0);
		const pitch = THREE.MathUtils.degToRad(60);
		const forward = new THREE.Vector3(
			0,
			Math.sin(pitch),
			Math.cos(pitch),
		).normalize();
		const up = new THREE.Vector3(
			0,
			Math.cos(pitch),
			-Math.sin(pitch),
		).normalize();

		for (let i = 0; i < 24; i++) {
			pos.z += 0.35;
			trail.update(
				stubPlayer({ pos, forward, up, grounded: false }) as never,
				true,
				1 / 60,
			);
		}

		const ribbon = trail.root.getObjectByName("boostAirRibbon") as THREE.Mesh;
		expect(ribbon.visible).toBe(true);
		const attr = ribbon.geometry.getAttribute("position");
		let minZ = Infinity;
		let maxZ = -Infinity;
		let maxAbsYOff = 0;
		for (let i = 0; i < attr.count; i++) {
			const y = attr.getY(i);
			const z = attr.getZ(i);
			if (!Number.isFinite(z)) continue;
			minZ = Math.min(minZ, z);
			maxZ = Math.max(maxZ, z);
			maxAbsYOff = Math.max(maxAbsYOff, Math.abs(y - 4));
		}
		expect(maxZ - minZ).toBeGreaterThan(2.5);
		/** Szerokość wstęgi w world-up — nie krawędź karty. */
		expect(maxAbsYOff).toBeGreaterThan(0.25);
	});

	it("na ziemi zostaje płaską smugą na murawie", () => {
		const scene = new THREE.Scene();
		const trail = new BoostTrail(scene);
		const pos = new THREE.Vector3(0, 0.4, 0);
		const forward = new THREE.Vector3(0, 0, 1);
		const up = new THREE.Vector3(0, 1, 0);

		for (let i = 0; i < 12; i++) {
			pos.z += 0.4;
			trail.update(
				stubPlayer({ pos, forward, up, grounded: true }) as never,
				true,
				1 / 60,
			);
		}

		const live = trail.root.children.find(
			(c) => c.visible && c.name !== "boostAirRibbon",
		) as THREE.Mesh;
		expect(live).toBeTruthy();
		const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(live.quaternion);
		expect(Math.abs(normal.y)).toBeGreaterThan(0.9);
	});
});
