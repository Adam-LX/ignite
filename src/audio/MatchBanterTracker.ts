import type { CommentaryEvent } from "./MatchCommentator";
import { isMeridianArenaActive } from "../visual/meridianArena";

export type BanterCar = {
	isHuman?: boolean;
	isBoosting?(): boolean;
	player: {
		getPosition(): { x: number; y: number; z: number };
		getVelocity(): { x: number; y: number; z: number; length(): number };
		getUpward(): {
			x: number;
			y: number;
			z: number;
			dot(v: { x: number; y: number; z: number }): number;
		};
		getSurfaceNormal(): { x: number; y: number; z: number };
		isBoosting?(): boolean;
	};
	team: "blue" | "orange" | null;
	visualTeam: "blue" | "orange";
};

export type BanterFrame = {
	humanTouched: boolean;
	humanImpact: number;
	humanWhiff: boolean;
	blueScore: number;
	orangeScore: number;
};

/**
 * Detektor banteru — sytuacje boiskowe + inicjatywa / roast / pochwały gracza i drużyn.
 */
export class MatchBanterTracker {
	private idleBallSec = 0;
	private scrambleHoldSec = 0;
	private fiftyHoldSec = 0;
	private turtleHoldSec = 0;

	private sinceHumanTouchSec = 0;
	private humanFarSec = 0;
	private hustleSec = 0;
	private initiative = 0;
	private hotArmed = false;
	private lazyArmed = false;
	private lastScoreGap = 0;
	private pending: CommentaryEvent | null = null;
	private teamBanterCooldown = 0;

	reset(): void {
		this.idleBallSec = 0;
		this.scrambleHoldSec = 0;
		this.fiftyHoldSec = 0;
		this.turtleHoldSec = 0;
		this.sinceHumanTouchSec = 0;
		this.humanFarSec = 0;
		this.hustleSec = 0;
		this.initiative = 0;
		this.hotArmed = false;
		this.lazyArmed = false;
		this.lastScoreGap = 0;
		this.pending = null;
		this.teamBanterCooldown = 0;
	}

	/** Natychmiastowa pochwała / docinek z GameSession (hit / save / whiff). */
	noteHumanTouch(impact: number): void {
		this.sinceHumanTouchSec = 0;
		this.lazyArmed = false;
		this.initiative = Math.min(1, this.initiative + 0.12 + Math.min(0.2, impact * 0.012));
		if (impact >= 10) this.queue("player_praise");
		else if (impact >= 5) this.initiative = Math.min(1, this.initiative + 0.08);
	}

	noteHumanWhiff(): void {
		this.queue("player_roast");
		this.initiative = Math.max(0, this.initiative - 0.18);
	}

	noteHumanSave(): void {
		this.sinceHumanTouchSec = 0;
		this.queue("player_praise");
		this.initiative = Math.min(1, this.initiative + 0.22);
	}

	noteHumanDemo(asAttacker: boolean): void {
		if (asAttacker) {
			this.queue("player_praise");
			this.initiative = Math.min(1, this.initiative + 0.15);
		} else {
			this.queue("player_roast");
		}
	}

	private queue(ev: CommentaryEvent): void {
		if (!this.pending) this.pending = ev;
	}

	update(
		dt: number,
		ballPos: { x: number; y: number; z: number },
		ballVel: { x: number; y: number; z: number },
		cars: BanterCar[],
		active: boolean,
		frame?: BanterFrame,
	): CommentaryEvent | null {
		if (!active) {
			this.reset();
			return null;
		}

		if (this.pending) {
			const ev = this.pending;
			this.pending = null;
			return ev;
		}

		this.teamBanterCooldown = Math.max(0, this.teamBanterCooldown - dt);

		const ballSpeed = Math.hypot(ballVel.x, ballVel.y, ballVel.z);
		if (ballSpeed < 2.2) this.idleBallSec += dt;
		else this.idleBallSec = 0;

		const human = cars.find((c) => c.isHuman) ?? null;
		let nearBall = 0;
		let blueNear = 0;
		let orangeNear = 0;
		let turtle = false;
		let humanDist = 999;
		let humanClosing = false;
		let humanBoosting = false;

		for (const car of cars) {
			const pos = car.player.getPosition();
			const dist = Math.hypot(
				pos.x - ballPos.x,
				pos.y - ballPos.y,
				pos.z - ballPos.z,
			);
			if (dist < 7.5) {
				nearBall++;
				if (car.team === "blue" || car.visualTeam === "blue") blueNear++;
				if (car.team === "orange" || car.visualTeam === "orange") {
					orangeNear++;
				}
			}

			const up = car.player.getUpward();
			if (isMeridianArenaActive()) {
				const n = car.player.getSurfaceNormal();
				if (up.dot(n) < -0.15) turtle = true;
			} else if (up.y < -0.15) {
				turtle = true;
			}

			if (car.isHuman) {
				humanDist = dist;
				const vel = car.player.getVelocity();
				const toBallX = ballPos.x - pos.x;
				const toBallY = ballPos.y - pos.y;
				const toBallZ = ballPos.z - pos.z;
				const toLen = Math.hypot(toBallX, toBallY, toBallZ) || 1;
				const closing =
					(vel.x * toBallX + vel.y * toBallY + vel.z * toBallZ) / toLen;
				humanClosing = closing > 4.5 && dist > 6;
				humanBoosting = Boolean(
					car.isBoosting?.() ?? car.player.isBoosting?.(),
				);
			}
		}

		if (frame?.humanTouched) {
			this.noteHumanTouch(frame.humanImpact);
		} else if (frame?.humanWhiff) {
			this.noteHumanWhiff();
		} else {
			this.sinceHumanTouchSec += dt;
		}

		/** Inicjatywa: blisko + pogoń / boost → w górę; daleko bez kontaktu → w dół. */
		if (human) {
			if (humanDist < 9) {
				this.initiative = Math.min(1, this.initiative + dt * 0.08);
				this.humanFarSec = 0;
			} else if (humanDist > 16) {
				this.humanFarSec += dt;
				this.initiative = Math.max(0, this.initiative - dt * 0.045);
			} else {
				this.humanFarSec = 0;
			}

			if (humanClosing || (humanBoosting && humanDist > 8)) {
				this.hustleSec += dt;
				this.initiative = Math.min(1, this.initiative + dt * 0.14);
			} else {
				this.hustleSec = 0;
			}
		}

		if (nearBall >= 3) this.scrambleHoldSec += dt;
		else this.scrambleHoldSec = 0;

		if (blueNear >= 1 && orangeNear >= 1 && nearBall >= 2) {
			this.fiftyHoldSec += dt;
		} else {
			this.fiftyHoldSec = 0;
		}

		if (turtle) this.turtleHoldSec += dt;
		else this.turtleHoldSec = 0;

		const blueScore = frame?.blueScore ?? 0;
		const orangeScore = frame?.orangeScore ?? 0;
		const gap = Math.abs(blueScore - orangeScore);
		if (gap >= 3 && gap > this.lastScoreGap) {
			this.lastScoreGap = gap;
			return "score_taunt";
		}
		if (gap < this.lastScoreGap) this.lastScoreGap = gap;

		/** Priorytet: hustle → hot → lazy/spectator → scramble → … */
		if (this.hustleSec > 1.1) {
			this.hustleSec = 0;
			return "player_hustle";
		}

		if (this.initiative >= 0.78 && !this.hotArmed) {
			this.hotArmed = true;
			return "player_hot";
		}
		if (this.initiative < 0.45) this.hotArmed = false;

		if (
			!this.lazyArmed &&
			this.sinceHumanTouchSec > 9 &&
			this.humanFarSec > 5.5 &&
			ballSpeed > 3
		) {
			this.lazyArmed = true;
			return humanDist > 22 ? "player_spectator" : "player_lazy";
		}
		if (this.sinceHumanTouchSec < 3) this.lazyArmed = false;

		if (this.scrambleHoldSec > 0.85) {
			this.scrambleHoldSec = 0;
			return "scramble";
		}
		if (this.fiftyHoldSec > 0.55) {
			this.fiftyHoldSec = 0;
			return "fifty_fifty";
		}
		if (this.turtleHoldSec > 0.7) {
			this.turtleHoldSec = 0;
			return "turtle";
		}
		if (this.idleBallSec > 4.2) {
			this.idleBallSec = 0;
			return "idle_ball";
		}

		/** Team praise/roast przy dominacji blisko piłki. */
		if (this.teamBanterCooldown <= 0) {
			if (blueNear >= 2 && orangeNear === 0 && nearBall >= 2) {
				this.teamBanterCooldown = 12;
				return Math.random() < 0.55 ? "blue_praise" : "orange_roast";
			}
			if (orangeNear >= 2 && blueNear === 0 && nearBall >= 2) {
				this.teamBanterCooldown = 12;
				return Math.random() < 0.55 ? "orange_praise" : "blue_roast";
			}
		}

		return null;
	}
}
