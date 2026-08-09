import type RAPIER from "@dimforge/rapier3d-compat";

import type GameObject from "../../GameObject";

export type BallSurfaceKind = "wall" | "ceiling" | "floor";

export type BallSurfaceEvent = {
	kind: BallSurfaceKind;
	timeSec: number;
};

/** Ostatni kontakt piłki ze ścianą / sufitem — do wall shot / double tap. */
export class BallSurfaceTracker {
	private lastWallTime = -999;
	private lastCeilingTime = -999;
	private lastFloorTime = -999;

	reset(): void {
		this.lastWallTime = -999;
		this.lastCeilingTime = -999;
		this.lastFloorTime = -999;
	}

	sample(
		world: RAPIER.World,
		ball: GameObject,
		nowSec: number,
		isArenaCollider: (collider: RAPIER.Collider) => boolean,
	): void {
		const ballCollider = ball.rapierCollider;
		world.contactPairsWith(ballCollider, (other) => {
			if (!isArenaCollider(other)) return;
			world.contactPair(ballCollider, other, (manifold, flipped) => {
				if (manifold.numSolverContacts() < 1) return;
				const raw = manifold.normal();
				const ny = flipped ? -raw.y : raw.y;
				const nx = flipped ? -raw.x : raw.x;
				const nz = flipped ? -raw.z : raw.z;
				if (ny > 0.72) {
					this.lastFloorTime = nowSec;
				} else if (ny < -0.55) {
					this.lastCeilingTime = nowSec;
				} else if (Math.abs(nx) + Math.abs(nz) > 0.45) {
					this.lastWallTime = nowSec;
				}
			});
		});
	}

	lastWallAge(nowSec: number): number {
		return nowSec - this.lastWallTime;
	}

	lastCeilingAge(nowSec: number): number {
		return nowSec - this.lastCeilingTime;
	}

	lastFloorAge(nowSec: number): number {
		return nowSec - this.lastFloorTime;
	}

	recentWall(nowSec: number, withinSec = 1.6): boolean {
		return this.lastWallAge(nowSec) <= withinSec;
	}

	recentCeiling(nowSec: number, withinSec = 1.6): boolean {
		return this.lastCeilingAge(nowSec) <= withinSec;
	}

	recentBackboard(nowSec: number, withinSec = 1.2): boolean {
		return (
			this.lastWallAge(nowSec) <= withinSec ||
			this.lastCeilingAge(nowSec) <= withinSec ||
			this.lastFloorAge(nowSec) <= withinSec
		);
	}
}
