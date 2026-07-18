import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";

import GameObject from "../../src/GameObject";
import Scene from "../../src/Scene";
import { RL_BALL } from "../../src/util/rlConstants";
import { FALLBACK_ARENA_CATALOG, setArenaCatalogForTests } from "../../src/arena/ArenaCatalog";
import { ArenaRuntime, initArenaRuntime, resetArenaRuntime } from "../../src/arena/ArenaRuntime";
import { buildArenaPhysics } from "../../src/visual/arena";
import { RL_ARENA } from "../../src/visual/arenaConstants";

beforeAll(async () => {
	await RAPIER.init();
});

function createBall(scene: Scene): GameObject {
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(RL_BALL.radius));
	return new GameObject(scene, mesh, {
		colliderDesc: RAPIER.ColliderDesc.ball(RL_BALL.radius),
		rigidBodyDesc: RAPIER.RigidBodyDesc.dynamic(),
	});
}

describe("Arena variants physics", () => {
	for (const arenaId of ["standard", "compact"] as const) {
		it(`piłka spada na murawę — ${arenaId}`, () => {
			setArenaCatalogForTests(FALLBACK_ARENA_CATALOG);
			resetArenaRuntime();
			initArenaRuntime(arenaId);

			const scene = new Scene();
			buildArenaPhysics(scene.rapierWorld);
			const ball = createBall(scene);
			ball.rapierRigidBody.setTranslation(
				{ x: 0, y: RL_BALL.radius + 2, z: 0 },
				true,
			);

			for (let i = 0; i < 30; i++) {
				scene.advancePhysics(1 / 60);
			}

			const y = ball.rapierRigidBody.translation().y;
			expect(y).toBeLessThan(RL_BALL.radius + 1.5);
			expect(y).toBeGreaterThan(-0.5);
			expect(RL_ARENA.WIDTH).toBe(
				arenaId === "compact" ? 64 : 80,
			);
		});
	}
});
