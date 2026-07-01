import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import type GameObject from "../GameObject";
import type { CarEntity } from "./CarEntity";

export type BodySnapshot = {
	px: number;
	py: number;
	pz: number;
	qx: number;
	qy: number;
	qz: number;
	qw: number;
};

export type ReplayFrame = {
	t: number;
	ball: BodySnapshot;
	cars: BodySnapshot[];
};

const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();

function sortedCars(cars: CarEntity[]): CarEntity[] {
	return cars.length <= 1
		? cars
		: [...cars].sort((a, b) => a.slotIndex - b.slotIndex);
}

function snapshotBody(body: RAPIER.RigidBody): BodySnapshot {
	const t = body.translation();
	const r = body.rotation();
	return { px: t.x, py: t.y, pz: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w };
}

/** Tylko wizualka + ciche ustawienie Rapiera (getPosition / VFX). */
function applyVisualSnapshot(
	body: RAPIER.RigidBody,
	meshRoot: THREE.Object3D,
	snap: BodySnapshot,
): void {
	meshRoot.position.set(snap.px, snap.py, snap.pz);
	meshRoot.quaternion.set(snap.qx, snap.qy, snap.qz, snap.qw);
	body.setTranslation({ x: snap.px, y: snap.py, z: snap.pz }, false);
	body.setRotation({ x: snap.qx, y: snap.qy, z: snap.qz, w: snap.qw }, false);
	body.setLinvel({ x: 0, y: 0, z: 0 }, false);
	body.setAngvel({ x: 0, y: 0, z: 0 }, false);
}

function lerpSnapshot(
	a: BodySnapshot,
	b: BodySnapshot,
	u: number,
): BodySnapshot {
	_qA.set(a.qx, a.qy, a.qz, a.qw);
	_qB.set(b.qx, b.qy, b.qz, b.qw);
	_qA.slerp(_qB, u);
	return {
		px: THREE.MathUtils.lerp(a.px, b.px, u),
		py: THREE.MathUtils.lerp(a.py, b.py, u),
		pz: THREE.MathUtils.lerp(a.pz, b.pz, u),
		qx: _qA.x,
		qy: _qA.y,
		qz: _qA.z,
		qw: _qA.w,
	};
}

export type ReplayPlaybackOptions = {
	/** Moment przekroczenia linii w czasie klipu (s od startu powtórki). */
	goalCrossTime: number;
	/** Bazowe tempo odtwarzania (< 1 = wolniej). */
	baseSpeed?: number;
	/** Mnożnik zwolnienia przy bramce (× baseSpeed). */
	goalSlowMul?: number;
	/** Ile sekund klipu przed bramką zaczyna się slow-mo. */
	goalSlowBefore?: number;
	/** Ile sekund klipu po bramce trwa slow-mo. */
	goalSlowAfter?: number;
};

const DEFAULT_REPLAY_PLAYBACK: Required<ReplayPlaybackOptions> = {
	goalCrossTime: 0,
	baseSpeed: 0.78,
	goalSlowMul: 0.2,
	goalSlowBefore: 0.72,
	goalSlowAfter: 1.75,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}
function normalizeClipTimes(frames: ReplayFrame[]): ReplayFrame[] {
	if (frames.length === 0) return [];
	const t0 = frames[0]!.t;
	return frames.map((f) => ({ ...f, t: f.t - t0 }));
}

/** Bufor ostatnich klatek meczu — materiał na powtórkę (akcja przed bramką). */
export class GoalReplayRecorder {
	private readonly frames: ReplayFrame[] = [];
	private readonly maxSec: number;
	private lastRecordT = -1;

	constructor(maxSec = 12) {
		this.maxSec = maxSec;
	}

	clear(): void {
		this.frames.length = 0;
		this.lastRecordT = -1;
	}

	record(t: number, ball: GameObject, cars: CarEntity[]): void {
		if (t - this.lastRecordT < 1 / 120) return;
		this.lastRecordT = t;

		this.frames.push({
			t,
			ball: snapshotBody(ball.rapierRigidBody),
			cars: sortedCars(cars).map((c) => snapshotBody(c.player.rapierRigidBody)),
		});
		while (this.frames.length > 1 && t - this.frames[0]!.t > this.maxSec) {
			this.frames.shift();
		}
	}

	buildClip(fromT: number, toT: number): ReplayFrame[] {
		if (this.frames.length === 0) return [];

		const span = Math.max(0.01, toT - fromT);
		let clip = this.frames.filter((f) => f.t >= fromT && f.t <= toT);
		if (clip.length < 2) {
			const goalIdx = this.frames.findIndex((f) => f.t >= fromT);
			const anchor = goalIdx >= 0 ? goalIdx : this.frames.length - 1;
			const start = Math.max(0, anchor - Math.ceil(span * 120));
			clip = this.frames.slice(start);
		}
		if (clip.length < 2) {
			clip = this.frames.slice(
				-Math.min(Math.ceil(span * 120), this.frames.length),
			);
		}
		if (clip.length < 2) return [];

		clip = normalizeClipTimes(clip);
		const last = clip[clip.length - 1]!;
		let holdT = last.t;
		const holdDt = 1 / 60;
		while (holdT + holdDt < span - 1e-4) {
			holdT += holdDt;
			clip.push({
				t: holdT,
				ball: { ...last.ball },
				cars: last.cars.map((c) => ({ ...c })),
			});
		}
		return clip;
	}
}

export class GoalReplayPlayer {
	private frames: ReplayFrame[] = [];
	private sortedCars: CarEntity[] = [];
	private duration = 0;
	private elapsed = 0;
	private playing = false;
	private playback: Required<ReplayPlaybackOptions> = {
		...DEFAULT_REPLAY_PLAYBACK,
	};

	setClip(
		frames: ReplayFrame[],
		cars: CarEntity[],
		playback?: ReplayPlaybackOptions,
	): void {
		this.sortedCars = sortedCars(cars);
		this.frames = frames;
		this.playback = { ...DEFAULT_REPLAY_PLAYBACK, ...playback };
		if (frames.length < 2) {
			this.playing = false;
			this.elapsed = 0;
			this.duration = 0;
			return;
		}
		this.duration = Math.max(0.01, frames[frames.length - 1]!.t);
		this.elapsed = 0;
		this.playing = true;
	}

	private clipTimeScale(clipT: number): number {
		const {
			baseSpeed,
			goalSlowMul,
			goalCrossTime,
			goalSlowBefore,
			goalSlowAfter,
		} = this.playback;
		const slowSpeed = baseSpeed * goalSlowMul;
		const slowStart = goalCrossTime - goalSlowBefore;
		const slowEnd = goalCrossTime + goalSlowAfter;

		if (clipT <= slowStart || clipT >= slowEnd) return baseSpeed;
		if (clipT < goalCrossTime) {
			return THREE.MathUtils.lerp(
				baseSpeed,
				slowSpeed,
				smoothstep(slowStart, goalCrossTime, clipT),
			);
		}
		return THREE.MathUtils.lerp(
			slowSpeed,
			baseSpeed,
			smoothstep(goalCrossTime, slowEnd, clipT),
		);
	}

	get isPlaying(): boolean {
		return this.playing;
	}

	stop(): void {
		this.playing = false;
	}

	update(dt: number, ball: GameObject, cars: CarEntity[]): boolean {
		this.sortedCars = sortedCars(cars);
		if (!this.playing || this.frames.length < 2) {
			this.playing = false;
			return true;
		}

		this.elapsed += dt * this.clipTimeScale(this.elapsed);
		const t = this.elapsed;
		if (t >= this.duration) {
			this.applyFrame(this.frames[this.frames.length - 1]!, ball);
			this.playing = false;
			return true;
		}

		let i = 0;
		while (i + 1 < this.frames.length && this.frames[i + 1]!.t < t) i++;
		const a = this.frames[i]!;
		const b = this.frames[Math.min(i + 1, this.frames.length - 1)]!;
		const span = Math.max(1e-6, b.t - a.t);
		const u = THREE.MathUtils.clamp((t - a.t) / span, 0, 1);
		this.applyInterpolated(a, b, u, ball);
		return false;
	}

	private applyFrame(frame: ReplayFrame, ball: GameObject): void {
		applyVisualSnapshot(ball.rapierRigidBody, ball.threeJSGroup, frame.ball);
		for (let i = 0; i < this.sortedCars.length; i++) {
			const snap = frame.cars[i];
			if (!snap) continue;
			const car = this.sortedCars[i]!;
			applyVisualSnapshot(
				car.player.rapierRigidBody,
				car.player.threeJSGroup,
				snap,
			);
		}
	}

	private applyInterpolated(
		a: ReplayFrame,
		b: ReplayFrame,
		u: number,
		ball: GameObject,
	): void {
		applyVisualSnapshot(
			ball.rapierRigidBody,
			ball.threeJSGroup,
			lerpSnapshot(a.ball, b.ball, u),
		);
		for (let i = 0; i < this.sortedCars.length; i++) {
			const sa = a.cars[i];
			const sb = b.cars[i];
			if (!sa || !sb) continue;
			applyVisualSnapshot(
				this.sortedCars[i]!.player.rapierRigidBody,
				this.sortedCars[i]!.player.threeJSGroup,
				lerpSnapshot(sa, sb, u),
			);
		}
	}

	private sampleBall(uTime: number): BodySnapshot {
		if (this.frames.length === 0) {
			return { px: 0, py: 1, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
		}
		const t = THREE.MathUtils.clamp(uTime, 0, this.duration);
		let i = 0;
		while (i + 1 < this.frames.length && this.frames[i + 1]!.t < t) i++;
		const a = this.frames[i]!;
		const b = this.frames[Math.min(i + 1, this.frames.length - 1)]!;
		const span = Math.max(1e-6, b.t - a.t);
		const u = THREE.MathUtils.clamp((t - a.t) / span, 0, 1);
		return lerpSnapshot(a.ball, b.ball, u);
	}

	ballPosition(out: THREE.Vector3): THREE.Vector3 {
		const snap = this.sampleBall(this.elapsed);
		return out.set(snap.px, snap.py, snap.pz);
	}

	ballVelocity(out: THREE.Vector3): THREE.Vector3 {
		if (this.frames.length < 2) return out.set(0, 0, 0);
		const t = THREE.MathUtils.clamp(this.elapsed, 0, this.duration);
		let i = 0;
		while (i + 1 < this.frames.length && this.frames[i + 1]!.t < t) i++;
		const a = this.frames[i]!;
		const b = this.frames[Math.min(i + 1, this.frames.length - 1)]!;
		const dt = Math.max(1e-4, b.t - a.t);
		return out.set(
			(b.ball.px - a.ball.px) / dt,
			(b.ball.py - a.ball.py) / dt,
			(b.ball.pz - a.ball.pz) / dt,
		);
	}
}
