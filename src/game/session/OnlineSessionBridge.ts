import type GameObject from "../../GameObject";
import type { CarEntity } from "../CarEntity";
import type { MatchController } from "../../modes/MatchController";
import { GuestReconcilePool } from "../../net/guestReconcile";
import { SNAPSHOT_RATE_HZ } from "../../net/protocol";
import type { RoomClient } from "../../net/RoomClient";
import { buildWorldSnapshot } from "../../net/snapshotCodec";
import { StateInterpolator } from "../../net/StateInterpolator";

/**
 * Host snapshot pacing + guest interpolate/reconcile state.
 * Owned by GameSession; keeps net plumbing out of the god-file body.
 */
export class OnlineSessionBridge {
	snapshotAccumulator = 0;
	netTick = 0;
	readonly stateInterpolator = new StateInterpolator();
	readonly guestReconcile = new GuestReconcilePool();

	clear(): void {
		this.stateInterpolator.clear();
		this.guestReconcile.reset();
		this.snapshotAccumulator = 0;
		this.netTick = 0;
	}

	sendHostSnapshot(opts: {
		role: "host" | "guest" | undefined;
		roomClient: RoomClient;
		ball: GameObject;
		cars: CarEntity[];
		match: MatchController;
		dt: number;
	}): void {
		if (opts.role !== "host") return;
		this.snapshotAccumulator += opts.dt;
		const interval = 1 / SNAPSHOT_RATE_HZ;
		while (this.snapshotAccumulator >= interval) {
			this.snapshotAccumulator -= interval;
			opts.roomClient.sendSnapshot(
				buildWorldSnapshot(
					++this.netTick,
					opts.ball,
					opts.cars,
					opts.match,
				),
			);
		}
	}
}
