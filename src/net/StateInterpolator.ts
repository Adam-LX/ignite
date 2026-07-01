import type { WorldSnapshotPayload } from "./protocol";
import { INTERPOLATION_DELAY_MS } from "./protocol";

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

export class StateInterpolator {
	private readonly buffer: TimedSnapshot[] = [];
	private latest: WorldSnapshotPayload | null = null;
	private hostClockOffset: number | null = null;

	push(snapshot: WorldSnapshotPayload): void {
		const receivedAt = performance.now();
		if (this.hostClockOffset === null) {
			this.hostClockOffset = receivedAt - snapshot.serverTimeMs;
		}
		const timeMs = snapshot.serverTimeMs + this.hostClockOffset;
		this.buffer.push({ timeMs, snapshot });
		this.latest = snapshot;
		while (this.buffer.length > 10) {
			this.buffer.shift();
		}
	}

	getLatest(): WorldSnapshotPayload | null {
		return this.latest;
	}

	hasData(): boolean {
		return this.latest !== null;
	}

	clear(): void {
		this.buffer.length = 0;
		this.latest = null;
		this.hostClockOffset = null;
	}

	sample(nowMs = performance.now()): WorldSnapshotPayload | null {
		if (this.buffer.length === 0) return null;
		const renderTime = nowMs - INTERPOLATION_DELAY_MS;

		if (this.buffer.length === 1) {
			return this.buffer[0]!.snapshot;
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
		if (!newer) return older.snapshot;

		const span = newer.timeMs - older.timeMs;
		const t = span > 0 ? (renderTime - older.timeMs) / span : 0;
		const clamped = Math.max(0, Math.min(1, t));
		return interpolateSnapshots(older.snapshot, newer.snapshot, clamped);
	}
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
	};
}
