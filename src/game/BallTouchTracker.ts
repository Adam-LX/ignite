import type RAPIER from "@dimforge/rapier3d-compat";
import type * as THREE from "three";

import type GameObject from "../GameObject";
import type { CarEntity } from "./CarEntity";
import type { ScoringTeam } from "./modes";

const MAX_TOUCHES = 16;

export type BallTouchRecord = {
	slotIndex: number;
	timeSec: number;
	ballY: number;
	inAir: boolean;
	flipping: boolean;
	onWall: boolean;
	impact: number;
	carPos: THREE.Vector3;
};

export type GoalTouchContext = {
	scoringTeam: ScoringTeam;
	scorerSlot: number | null;
	assistSlot: number | null;
	isOwnGoal: boolean;
	lastTouch: BallTouchRecord | null;
	prevTouch: BallTouchRecord | null;
};

export class BallTouchTracker {
	lastTouchSlotId: number | null = null;
	private lastTouchTime = 0;
	private readonly touches: BallTouchRecord[] = [];

	reset(): void {
		this.lastTouchSlotId = null;
		this.lastTouchTime = 0;
		this.touches.length = 0;
	}

	update(
		world: RAPIER.World,
		cars: CarEntity[],
		ball: GameObject,
		nowSec: number,
	): void {
		const ballY = ball.getPosition().y;
		for (const car of cars) {
			world.contactPair(car.player.rapierCollider, ball.rapierCollider, () => {
				this.recordTouch(car, ballY, nowSec, 0);
			});
		}
	}

	/** Uzupełnij impact po applyCarBallHits (ten sam slot, ta sama klatka). */
	noteImpact(slotIndex: number, impact: number, nowSec: number): void {
		if (impact <= 0) return;
		const last = this.touches[this.touches.length - 1];
		if (last && last.slotIndex === slotIndex && nowSec - last.timeSec < 0.05) {
			last.impact = Math.max(last.impact, impact);
		}
	}

	private recordTouch(
		car: CarEntity,
		ballY: number,
		nowSec: number,
		impact: number,
	): void {
		const last = this.touches[this.touches.length - 1];
		if (
			last &&
			last.slotIndex === car.slotIndex &&
			nowSec - last.timeSec < 0.04
		) {
			last.impact = Math.max(last.impact, impact);
			return;
		}

		this.lastTouchSlotId = car.slotIndex;
		this.lastTouchTime = nowSec;
		this.touches.push({
			slotIndex: car.slotIndex,
			timeSec: nowSec,
			ballY,
			inAir: !car.player.isOnGround(),
			flipping: car.player.isFlipping(),
			onWall: car.player.isOnWallOrRamp(),
			impact,
			carPos: car.player.getPosition().clone(),
		});
		if (this.touches.length > MAX_TOUCHES) {
			this.touches.shift();
		}
	}

	getScorerSlot(fallback: number | null = null): number | null {
		return this.lastTouchSlotId ?? fallback;
	}

	touchAge(nowSec: number): number {
		return this.lastTouchTime > 0 ? nowSec - this.lastTouchTime : Infinity;
	}

	getLastTouch(): BallTouchRecord | null {
		return this.touches[this.touches.length - 1] ?? null;
	}

	getPreviousTouch(): BallTouchRecord | null {
		if (this.touches.length < 2) return null;
		return this.touches[this.touches.length - 2] ?? null;
	}

	getRecentTouches(count: number): BallTouchRecord[] {
		return this.touches.slice(-count);
	}

	/** Testy — wstrzyknięcie dotyku bez Rapier. */
	pushTouch(record: BallTouchRecord): void {
		this.touches.push(record);
		if (this.touches.length > MAX_TOUCHES) {
			this.touches.shift();
		}
		this.lastTouchSlotId = record.slotIndex;
		this.lastTouchTime = record.timeSec;
	}

	buildGoalContext(
		scoringTeam: ScoringTeam,
		cars: CarEntity[],
		isFFA: boolean,
	): GoalTouchContext {
		const last = this.getLastTouch();
		const prev = this.getPreviousTouch();
		const scorerSlot = this.getScorerSlot(null);
		let assistSlot: number | null = null;
		let isOwnGoal = false;

		if (!isFFA && last && scorerSlot !== null) {
			const scorer = cars.find((c) => c.slotIndex === scorerSlot);
			if (scorer?.team && scorer.team !== scoringTeam) {
				isOwnGoal = true;
			}
			if (
				prev &&
				prev.slotIndex !== last.slotIndex &&
				last.timeSec - prev.timeSec < 8
			) {
				const prevCar = cars.find((c) => c.slotIndex === prev.slotIndex);
				const scorerCar = cars.find((c) => c.slotIndex === last.slotIndex);
				if (
					prevCar?.team &&
					scorerCar?.team &&
					prevCar.team === scorerCar.team
				) {
					assistSlot = prev.slotIndex;
				}
			}
		}

		return {
			scoringTeam,
			scorerSlot,
			assistSlot,
			isOwnGoal,
			lastTouch: last,
			prevTouch: prev,
		};
	}
}
