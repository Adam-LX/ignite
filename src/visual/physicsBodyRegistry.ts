import type RAPIER from "@dimforge/rapier3d-compat";

/** Tracks rigid bodies per Rapier world — safe when tests swap worlds. */
export function createPhysicsBodyRegistry() {
	let ownerWorld: RAPIER.World | null = null;
	const bodies: RAPIER.RigidBody[] = [];

	function clear(world: RAPIER.World): void {
		if (ownerWorld === world) {
			for (const body of bodies) {
				world.removeRigidBody(body);
			}
		}
		bodies.length = 0;
		ownerWorld = null;
	}

	function track(
		world: RAPIER.World,
		body: RAPIER.RigidBody,
	): RAPIER.RigidBody {
		if (ownerWorld !== null && ownerWorld !== world && bodies.length > 0) {
			clear(world);
		}
		ownerWorld = world;
		bodies.push(body);
		return body;
	}

	return { clear, track };
}
