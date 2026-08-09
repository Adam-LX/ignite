import { NETCODE } from "./netcodeTuning";
import type { WorldSnapshotPayload } from "./protocol";

type TimedSnapshot = {
	timeMs: number;
	snapshot: WorldSnapshotPayload;
};

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function lerpVec3(
	a: { x: number; y: number; z: number },
	b: { x: number; y: number; z: number },
	t: number,
): { x: number; y: number; z: number } {
	return {
		x: lerp(a.x, b.x, t),
		y: lerp(a.y, b.y, t),
		z: lerp(a.z, b.z, t),
	};
}

function slerpQuat(
	a: { x: number; y: number; z: number; w: number },
	b: { x: number; y: number; z: number; w: number },
	t: number,
): { x: number; y: number; z: number; w: number } {
	let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
	let bx = b.x;
	let by = b.y;
	let bz = b.z;
	let bw = b.w;
	if (dot < 0) {
		dot = -dot;
		bx = -bx;
		by = -by;
		bz = -bz;
		bw = -bw;
	}
	if (dot > 0.9995) {
		return {
			x: lerp(a.x, bx, t),
			y: lerp(a.y, by, t),
			z: lerp(a.z, bz, t),
			w: lerp(a.w, bw, t),
		};
	}
	const theta = Math.acos(dot);
	const sinTheta = Math.sin(theta);
	const wa = Math.sin((1 - t) * theta) / sinTheta;
	const wb = Math.sin(t * theta) / sinTheta;
	return {
		x: a.x * wa + bx * wb,
		y: a.y * wa + by * wb,
		z: a.z * wa + bz * wb,
		w: a.w * wa + bw * wb,
	};
}

function interpolateSnapshots(
	a: WorldSnapshotPayload,
	b: WorldSnapshotPayload,
	t: number,
): WorldSnapshotPayload {
	const cars = a.cars.map((carA) => {
		const carB = b.cars.find((c) => c.slot === carA.slot) ?? carA;
		return {
			slot: carA.slot,
			pos: lerpVec3(carA.pos, carB.pos, t),
			quat: slerpQuat(carA.quat, carB.quat, t),
			linvel: lerpVec3(carA.linvel, carB.linvel, t),
			angvel: lerpVec3(carA.angvel, carB.angvel, t),
			boost: lerp(carA.boost, carB.boost, t),
			boosting: t < 0.5 ? carA.boosting : carB.boosting,
		};
	});

	return {
		tick: t < 0.5 ? a.tick : b.tick,
		serverTimeMs: lerp(a.serverTimeMs, b.serverTimeMs, t),
		ball: {
			pos: lerpVec3(a.ball.pos, b.ball.pos, t),
			quat: slerpQuat(a.ball.quat, b.ball.quat, t),
			linvel: lerpVec3(a.ball.linvel, b.ball.linvel, t),
			angvel: lerpVec3(a.ball.angvel, b.ball.angvel, t),
		},
		cars,
		match: t < 0.5 ? a.match : b.match,
		playerStats: t < 0.5 ? a.playerStats : b.playerStats,
	};
}

/** Dead-reckoning — pozycja + prędkość × Δt (clampowany). */
export function extrapolateSnapshot(
	snapshot: WorldSnapshotPayload,
	dtSec: number,
): WorldSnapshotPayload {
	const dt = Math.max(0, Math.min(dtSec, NETCODE.EXTRAPOLATION_MAX_MS / 1000));

	const ballPos = {
		x: snapshot.ball.pos.x + snapshot.ball.linvel.x * dt,
		y: snapshot.ball.pos.y + snapshot.ball.linvel.y * dt,
		z: snapshot.ball.pos.z + snapshot.ball.linvel.z * dt,
	};

	return {
		...snapshot,
		ball: {
			...snapshot.ball,
			pos: ballPos,
		},
		cars: snapshot.cars.map((car) => ({
			...car,
			pos: {
				x: car.pos.x + car.linvel.x * dt,
				y: car.pos.y + car.linvel.y * dt,
				z: car.pos.z + car.linvel.z * dt,
			},
		})),
	};
}

export class StateInterpolator {
	private readonly buffer: TimedSnapshot[] = [];
	private latest: WorldSnapshotPayload | null = null;
	private hostClockOffset: number | null = null;
	private lastArrivalMs: number | null = null;
	private jitterEma = 0;
	private interpolationDelayMs: number = NETCODE.BASE_INTERPOLATION_DELAY_MS;

	push(snapshot: WorldSnapshotPayload): void {
		const receivedAt = performance.now();

		if (this.hostClockOffset === null) {
			this.hostClockOffset = receivedAt - snapshot.serverTimeMs;
		} else {
			const target = receivedAt - snapshot.serverTimeMs;
			this.hostClockOffset = lerp(
				this.hostClockOffset,
				target,
				NETCODE.CLOCK_SYNC_SMOOTHING,
			);
		}

		if (this.lastArrivalMs !== null) {
			const interval = receivedAt - this.lastArrivalMs;
			const deviation = Math.abs(
				interval - NETCODE.EXPECTED_SNAPSHOT_INTERVAL_MS,
			);
			this.jitterEma = lerp(
				this.jitterEma,
				deviation,
				NETCODE.JITTER_SMOOTHING,
			);
			this.interpolationDelayMs = Math.max(
				NETCODE.MIN_INTERPOLATION_DELAY_MS,
				Math.min(
					NETCODE.MAX_INTERPOLATION_DELAY_MS,
					NETCODE.BASE_INTERPOLATION_DELAY_MS + this.jitterEma * 2.2,
				),
			);
		}
		this.lastArrivalMs = receivedAt;

		const timeMs = snapshot.serverTimeMs + this.hostClockOffset;
		this.buffer.push({ timeMs, snapshot });
		this.latest = snapshot;
		while (this.buffer.length > NETCODE.BUFFER_MAX) {
			this.buffer.shift();
		}
	}

	getLatest(): WorldSnapshotPayload | null {
		return this.latest;
	}

	hasData(): boolean {
		return this.latest !== null;
	}

	getInterpolationDelayMs(): number {
		return this.interpolationDelayMs;
	}

	getJitterMs(): number {
		return this.jitterEma;
	}

	clear(): void {
		this.buffer.length = 0;
		this.latest = null;
		this.hostClockOffset = null;
		this.lastArrivalMs = null;
		this.jitterEma = 0;
		this.interpolationDelayMs = NETCODE.BASE_INTERPOLATION_DELAY_MS;
	}

	sample(nowMs = performance.now()): WorldSnapshotPayload | null {
		if (this.buffer.length === 0) return null;
		const renderTime = nowMs - this.interpolationDelayMs;

		if (this.buffer.length === 1) {
			const only = this.buffer[0]!;
			const aheadMs = renderTime - only.timeMs;
			if (aheadMs > 1) {
				return extrapolateSnapshot(
					only.snapshot,
					Math.min(aheadMs, NETCODE.EXTRAPOLATION_MAX_MS) / 1000,
				);
			}
			return only.snapshot;
		}

		let older: TimedSnapshot | null = null;
		let newer: TimedSnapshot | null = null;
		for (let i = 0; i < this.buffer.length; i++) {
			const entry = this.buffer[i]!;
			if (entry.timeMs <= renderTime) {
				older = entry;
			} else if (!newer) {
				newer = entry;
				break;
			}
		}

		if (!older) return this.buffer[0]!.snapshot;
		if (!newer) {
			const aheadMs = renderTime - older.timeMs;
			if (aheadMs > 1) {
				return extrapolateSnapshot(
					older.snapshot,
					Math.min(aheadMs, NETCODE.EXTRAPOLATION_MAX_MS) / 1000,
				);
			}
			return older.snapshot;
		}

		const span = newer.timeMs - older.timeMs;
		const t = span > 0 ? (renderTime - older.timeMs) / span : 0;
		const clamped = Math.max(0, Math.min(1, t));
		return interpolateSnapshots(older.snapshot, newer.snapshot, clamped);
	}
}
