import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Materiały kolizji areny — kalibracja pod Rocket League (120 Hz).
 * Piłka CR≈0.6; murawa tłumi (Min z piłką → ~0.38), ściany żywsze.
 */
export const RL_ARENA_PHYSICS = {
	/** Murawa — tłumi, ale nie „martwa” (Min z piłką 0.6 → 0.38). */
	floorRestitution: 0.38,
	floorFriction: 0.92,
	/** Ściany boczne / rampy — odbiór jak w RL. */
	wallRestitution: 0.48,
	wallFriction: 0.92,
	rampRestitution: 0.48,
	rampFriction: 0.92,
	/** Sufit — miększy niż ściany. */
	ceilingRestitution: 0.36,
	ceilingFriction: 0.85,
	/** Konstrukcja bramki / seal — twarde, mało sprężyste. */
	goalRestitution: 0.2,
	goalFriction: 0.9,
} as const;

export type ArenaSurfaceKind = "floor" | "wall" | "ramp" | "ceiling" | "goal";

export function arenaSurfaceMaterial(kind: ArenaSurfaceKind): {
	friction: number;
	restitution: number;
} {
	switch (kind) {
		case "floor":
			return {
				friction: RL_ARENA_PHYSICS.floorFriction,
				restitution: RL_ARENA_PHYSICS.floorRestitution,
			};
		case "wall":
			return {
				friction: RL_ARENA_PHYSICS.wallFriction,
				restitution: RL_ARENA_PHYSICS.wallRestitution,
			};
		case "ramp":
			return {
				friction: RL_ARENA_PHYSICS.rampFriction,
				restitution: RL_ARENA_PHYSICS.rampRestitution,
			};
		case "ceiling":
			return {
				friction: RL_ARENA_PHYSICS.ceilingFriction,
				restitution: RL_ARENA_PHYSICS.ceilingRestitution,
			};
		case "goal":
			return {
				friction: RL_ARENA_PHYSICS.goalFriction,
				restitution: RL_ARENA_PHYSICS.goalRestitution,
			};
	}
}

export function makeArenaCuboidCollider(
	hx: number,
	hy: number,
	hz: number,
	kind: ArenaSurfaceKind,
): RAPIER.ColliderDesc {
	const { friction, restitution } = arenaSurfaceMaterial(kind);
	return RAPIER.ColliderDesc.cuboid(hx, hy, hz)
		.setFriction(friction)
		.setRestitution(restitution);
}

export function makeArenaTrimeshCollider(
	positions: Float32Array,
	indices: Uint32Array,
	kind: "ramp" | "wall" = "ramp",
): RAPIER.ColliderDesc {
	const { friction, restitution } = arenaSurfaceMaterial(kind);
	return RAPIER.ColliderDesc.trimesh(positions, indices)
		.setFriction(friction)
		.setRestitution(restitution);
}
