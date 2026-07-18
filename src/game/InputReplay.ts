import * as THREE from "three";

import type GameObject from "../GameObject";
import type Scene from "../Scene";
import type { ControlInput } from "../util/ControlInput";
import {
	applyCarBallHitsAll,
	snapshotBallKinematics,
	updateBallPhysics,
} from "../util/rlContacts";
import type { CarEntity } from "./CarEntity";
import type { ReplayFrame } from "./GoalReplay";
import {
	applyFullBodySnapshot,
	DEFAULT_REPLAY_PLAYBACK,
	type ReplayPlaybackOptions,
	smoothstep,
} from "./GoalReplay";

/** Kompaktowy input per slot — ~24 B / tick. */
export type ReplaySlotInput = {
	forward: number;
	yaw: number;
	roll: number;
	boost: boolean;
	jumpHeld: boolean;
	shift: boolean;
};

export type ReplayInputFrame = {
	t: number;
	slots: ReplaySlotInput[];
};

export type GoalReplayClipPayload = {
	anchor: ReplayFrame;
	inputs: ReplayInputFrame[];
	goalCrossTime: number;
};

const EMPTY_SLOT: ReplaySlotInput = {
	forward: 0,
	yaw: 0,
	roll: 0,
	boost: false,
	jumpHeld: false,
	shift: false,
};

export class RecordedReplayInput implements ControlInput {
	private jumpEdge = false;

	constructor(private slot: ReplaySlotInput) {}

	setSlot(slot: ReplaySlotInput, jumpEdge: boolean): void {
		this.slot = slot;
		this.jumpEdge = jumpEdge;
	}

	forward(): number {
		return this.slot.forward;
	}
	yaw(): number {
		return this.slot.yaw;
	}
	roll(): number {
		return this.slot.roll;
	}
	isBoosting(): boolean {
		return this.slot.boost;
	}
	isShiftDown(): boolean {
		return this.slot.shift;
	}
	isJumpHeld(): boolean {
		return this.slot.jumpHeld;
	}
	consumeJump(): boolean {
		if (!this.jumpEdge) return false;
		this.jumpEdge = false;
		return true;
	}
	peekJump(): boolean {
		return this.jumpEdge;
	}
	consumeRecover(): boolean {
		return false;
	}
	hasFlipDirection(): boolean {
		return this.slot.forward !== 0 || this.slot.yaw !== 0;
	}
}

function captureSlotInput(input: ControlInput | undefined): ReplaySlotInput {
	if (!input) return EMPTY_SLOT;
	return {
		forward: input.forward(),
		yaw: input.yaw(),
		roll: input.roll(),
		boost: input.isBoosting(),
		jumpHeld: input.isJumpHeld(),
		shift: input.isShiftDown(),
	};
}

function sortedCars(cars: CarEntity[]): CarEntity[] {
	return cars.length <= 1
		? cars
		: [...cars].sort((a, b) => a.slotIndex - b.slotIndex);
}

export type ReplayPhysicsDeps = {
	scene: Scene;
	ball: GameObject;
	ballRadius: number;
};

/** Odtwarzanie gola przez resymulację inputów (anchor + fizyka). */
export class GoalReplayPhysicsPlayer {
	private sortedCars: CarEntity[] = [];
	private inputs: ReplayInputFrame[] = [];
	private duration = 0;
	private simTime = 0;
	private playing = false;
	private inputIdx = 0;
	private prevJumpHeld: boolean[] = [];
	private readonly replayInputs: RecordedReplayInput[] = [];
	private playback: Required<ReplayPlaybackOptions> = {
		...DEFAULT_REPLAY_PLAYBACK,
	};

	setClip(
		clip: GoalReplayClipPayload,
		cars: CarEntity[],
		ball: GameObject,
		playback?: ReplayPlaybackOptions,
	): void {
		this.sortedCars = sortedCars(cars);
		this.inputs = clip.inputs;
		this.playback = {
			...DEFAULT_REPLAY_PLAYBACK,
			...playback,
			goalCrossTime:
				playback?.goalCrossTime ?? clip.goalCrossTime ?? DEFAULT_REPLAY_PLAYBACK.goalCrossTime,
		};

		if (clip.inputs.length < 2) {
			this.playing = false;
			this.duration = 0;
			return;
		}

		const t0 = clip.inputs[0]!.t;
		this.inputs = clip.inputs.map((f) => ({ ...f, t: f.t - t0 }));
		this.duration = Math.max(0.01, this.inputs[this.inputs.length - 1]!.t);

		applyFullBodySnapshot(
			ball.rapierRigidBody,
			ball.threeJSGroup,
			clip.anchor.ball,
		);
		for (let i = 0; i < this.sortedCars.length; i++) {
			const snap = clip.anchor.cars[i];
			if (!snap) continue;
			const car = this.sortedCars[i]!;
			applyFullBodySnapshot(
				car.player.rapierRigidBody,
				car.player.threeJSGroup,
				snap,
			);
		}

		this.replayInputs.length = 0;
		this.prevJumpHeld = this.sortedCars.map(() => false);
		for (let i = 0; i < this.sortedCars.length; i++) {
			this.replayInputs.push(
				new RecordedReplayInput(clip.inputs[0]?.slots[i] ?? EMPTY_SLOT),
			);
		}

		this.simTime = 0;
		this.inputIdx = 0;
		this.playing = true;
	}

	get isPlaying(): boolean {
		return this.playing;
	}

	getDuration(): number {
		return this.duration;
	}

	getElapsed(): number {
		return this.simTime;
	}

	getProgress(): number {
		return this.duration > 0
			? THREE.MathUtils.clamp(this.simTime / this.duration, 0, 1)
			: 1;
	}

	stop(): void {
		this.playing = false;
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

	update(dt: number, deps: ReplayPhysicsDeps, cars: CarEntity[]): boolean {
		this.sortedCars = sortedCars(cars);
		if (!this.playing || this.inputs.length < 2) {
			this.playing = false;
			return true;
		}

		const scale = this.clipTimeScale(this.simTime);
		const scaledDt = dt * scale;
		this.simTime += scaledDt;
		if (this.simTime >= this.duration) {
			this.playing = false;
			return true;
		}

		while (
			this.inputIdx + 1 < this.inputs.length &&
			this.inputs[this.inputIdx + 1]!.t <= this.simTime
		) {
			this.inputIdx++;
		}

		const frame = this.inputs[this.inputIdx]!;
		for (let i = 0; i < this.sortedCars.length; i++) {
			const slot = frame.slots[i] ?? EMPTY_SLOT;
			const jumpEdge = slot.jumpHeld && !this.prevJumpHeld[i];
			this.prevJumpHeld[i] = slot.jumpHeld;
			const ri = this.replayInputs[i];
			if (!ri) continue;
			ri.setSlot(slot, jumpEdge);
			this.sortedCars[i]!.player.control(ri, scaledDt);
		}

		snapshotBallKinematics(deps.ball);
		const physicsStep = deps.scene.advancePhysics(
			scaledDt,
			(fixedDt, substep, substepCount) => {
				for (const car of this.sortedCars) {
					car.player.integrateHover(fixedDt, substep, substepCount);
				}
			},
			(_fixedDt, substep, substepCount) => {
				for (const car of this.sortedCars) {
					car.player.finalizeHoverStep(substep, substepCount);
				}
			},
		);
		const simDt = physicsStep.fixedDt * Math.max(1, physicsStep.steps);

		applyCarBallHitsAll(
			deps.scene.rapierWorld,
			this.sortedCars.map((c) => c.player),
			deps.ball,
		);
		const ballRadius = deps.ballRadius;
		updateBallPhysics(deps.ball, ballRadius, simDt, deps.scene.rapierWorld);

		for (const car of this.sortedCars) {
			car.player.syncWithRigidBody();
		}
		deps.ball.syncWithRigidBody();

		return false;
	}

	ballPosition(out: THREE.Vector3, ball: GameObject): THREE.Vector3 {
		return out.copy(ball.getPosition());
	}

	ballVelocity(out: THREE.Vector3, ball: GameObject): THREE.Vector3 {
		const v = ball.rapierRigidBody.linvel();
		return out.set(v.x, v.y, v.z);
	}
}

/** Bufor inputów zsynchronizowany z GoalReplayRecorder. */
export class GoalInputRecorder {
	private readonly frames: ReplayInputFrame[] = [];
	private readonly maxSec: number;
	private lastRecordT = -1;

	constructor(maxSec = 12) {
		this.maxSec = maxSec;
	}

	clear(): void {
		this.frames.length = 0;
		this.lastRecordT = -1;
	}

	record(
		t: number,
		cars: CarEntity[],
		resolveInput: (slot: number) => ControlInput | undefined,
	): void {
		if (t - this.lastRecordT < 1 / 120) return;
		this.lastRecordT = t;

		this.frames.push({
			t,
			slots: sortedCars(cars).map((c) =>
				captureSlotInput(resolveInput(c.slotIndex)),
			),
		});
		while (this.frames.length > 1 && t - this.frames[0]!.t > this.maxSec) {
			this.frames.shift();
		}
	}

	buildClip(
		fromT: number,
		toT: number,
		anchor: ReplayFrame,
		goalCrossTime?: number,
	): GoalReplayClipPayload | null {
		let clip = this.frames.filter((f) => f.t >= fromT && f.t <= toT);
		if (clip.length < 2) {
			const anchorIdx = this.frames.findIndex((f) => f.t >= fromT);
			const start = Math.max(0, anchorIdx - 60);
			clip = this.frames.slice(start);
		}
		if (clip.length < 2) return null;

		const t0 = clip[0]!.t;
		const normalized = clip.map((f) => ({ ...f, t: f.t - t0 }));
		return {
			anchor,
			inputs: normalized,
			goalCrossTime: goalCrossTime ?? Math.max(0, fromT - t0),
		};
	}
}
