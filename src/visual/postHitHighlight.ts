import * as THREE from "three";
import { RL_ARENA } from "./arenaConstants";
import {
	GOAL_MOUTH_HALF_WIDTH,
	GOAL_MOUTH_MAX_BALL_TOP_Y,
	isBallInsideGoalFrame,
} from "./goalPocket";

export type PostHitPresentation = {
	flash: number;
	banner: number;
	chromatic: number;
	shake: number;
	label: string;
};

const COOLDOWN_SEC = 1.1;

/** Etykieta HUD wg typu trafienia. */
export function postHitLabel(
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	ballRadius: number,
): string {
	const absX = Math.abs(ballPos.x);
	const mouthHalf = GOAL_MOUTH_HALF_WIDTH;
	const nearCrossbar =
		ballPos.y + ballRadius > GOAL_MOUTH_MAX_BALL_TOP_Y - ballRadius * 0.6;
	if (nearCrossbar) return "CROSSBAR!";
	if (absX > mouthHalf + ballRadius * 0.85) return "SO CLOSE!";
	const speed = ballVel.length();
	if (speed >= 20) return "POST!";
	return "POST!";
}

/** Wykrywa uderzenie w słupek / poprzeczkę lub ciasny miss obok bramki. */
export function evaluatePostHit(
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	ballRadius: number,
): boolean {
	const speed = ballVel.length();
	if (speed < 13) return false;

	const hl = RL_ARENA.HALF_LENGTH;
	const nearBlue = ballPos.z < -hl + 2.8 && ballPos.z > -hl - 1.5;
	const nearOrange = ballPos.z > hl - 2.8 && ballPos.z < hl + 1.5;
	if (!nearBlue && !nearOrange) return false;

	if (isBallInsideGoalFrame(ballPos, ballRadius, 0.04)) return false;

	const absX = Math.abs(ballPos.x);
	const mouthHalf = GOAL_MOUTH_HALF_WIDTH;
	const nearPost =
		absX > mouthHalf - ballRadius * 0.35 && absX < mouthHalf + ballRadius + 1.6;
	const nearCrossbar =
		ballPos.y + ballRadius > GOAL_MOUTH_MAX_BALL_TOP_Y - ballRadius * 0.6;
	const wideMiss = absX > mouthHalf + ballRadius * 0.85;

	if (!(nearPost || nearCrossbar || wideMiss)) return false;

	if (nearBlue && ballVel.z > -3.5) return false;
	if (nearOrange && ballVel.z < 3.5) return false;

	return true;
}

export class PostHitHighlight {
	private active = false;
	private elapsed = 0;
	private cooldown = 0;
	private label = "POST!";
	private impact = 0;

	reset(): void {
		this.active = false;
		this.elapsed = 0;
		this.cooldown = 0;
	}

	sample(
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		ballRadius: number,
		dt: number,
	): boolean {
		this.cooldown = Math.max(0, this.cooldown - dt);
		if (this.cooldown > 0) return false;
		if (!evaluatePostHit(ballPos, ballVel, ballRadius)) return false;
		this.active = true;
		this.elapsed = 0;
		this.cooldown = COOLDOWN_SEC;
		this.label = postHitLabel(ballPos, ballVel, ballRadius);
		this.impact = ballVel.length();
		return true;
	}

	update(dt: number): void {
		if (!this.active) return;
		this.elapsed += dt;
		if (this.elapsed >= 0.82) this.active = false;
	}

	isActive(): boolean {
		return this.active;
	}

	getImpact(): number {
		return this.impact;
	}

	getPresentation(): PostHitPresentation {
		if (!this.active) {
			return { flash: 0, banner: 0, chromatic: 0, shake: 0, label: "" };
		}
		const t = this.elapsed;
		const flash =
			t < 0.06 ? 1.08 - t / 0.06 : Math.max(0, 0.28 * (1 - (t - 0.06) / 0.2));
		const banner = t < 0.07 ? t / 0.07 : t < 0.58 ? 1 - (t - 0.07) / 0.51 : 0;
		const chromatic = t < 0.05 ? t / 0.05 : Math.max(0, 1 - (t - 0.05) / 0.24);
		const shake = t < 0.22 ? THREE.MathUtils.lerp(0.38, 0.06, t / 0.22) : 0;
		return { flash, banner, chromatic, shake, label: this.label };
	}
}

export function applyPostHitOverlay(p: PostHitPresentation): void {
	const flashEl = document.getElementById("post-hit-flash");
	const bannerEl = document.getElementById("post-hit-banner");
	if (!flashEl || !bannerEl) return;

	if (p.flash <= 0.01 && p.banner <= 0.01) {
		flashEl.style.opacity = "0";
		bannerEl.classList.remove("show");
		return;
	}

	flashEl.style.opacity = String(THREE.MathUtils.clamp(p.flash * 0.78, 0, 1));
	flashEl.style.setProperty(
		"--chromatic",
		String(THREE.MathUtils.clamp(p.chromatic, 0, 1)),
	);
	if (p.label) bannerEl.textContent = p.label;
	if (p.banner > 0.12) {
		bannerEl.classList.add("show");
	} else if (p.banner <= 0.05) {
		bannerEl.classList.remove("show");
	}
}
