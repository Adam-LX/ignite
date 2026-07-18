import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Materiały kolizji areny — kalibracja pod Rocket League (120 Hz).
 * Piłka CR≈0.6; murawa tłumi (Min z piłką → ~0.38), ściany żywsze.
 */
export const RL_ARENA_PHYSICS = {
	/** Murawa — tłumi, ale nie „martwa” (Min z piłką 0.6 → 0.38). */
	floorRestitution: 0.38,
	floorFriction: 0.92,
	/** Ściany / rampy — niska restytucja; niskie tarcie (jazda kinematyczna, nie grip Rapiera). */
	wallRestitution: 0.08,
	wallFriction: 0.18,
	rampRestitution: 0.05,
	rampFriction: 0.12,
	/** Sufit — niska restytucja; niskie tarcie (jazda kinematyczna jak na ścianie). */
	ceilingRestitution: 0.08,
	ceilingFriction: 0.15,
	/** Konstrukcja bramki / seal — twarde, mało sprężyste. */
	goalRestitution: 0.2,
	goalFriction: 0.9,
	/** Meridian — żywa skorupa: mocne odbicia, niski drag. */
	meridianRestitution: 1.0,
	meridianFriction: 0.12,
} as const;

export type ArenaSurfaceKind =
	| "floor"
	| "wall"
	| "ramp"
	| "ceiling"
	| "goal"
	| "meridian";

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
		case "meridian":
			return {
				friction: RL_ARENA_PHYSICS.meridianFriction,
				restitution: RL_ARENA_PHYSICS.meridianRestitution,
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
	kind: ArenaSurfaceKind = "ramp",
): RAPIER.ColliderDesc {
	const { friction, restitution } = arenaSurfaceMaterial(kind);
	return RAPIER.ColliderDesc.trimesh(positions, indices)
		.setFriction(friction)
		.setRestitution(restitution);
}
