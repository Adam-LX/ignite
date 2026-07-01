import * as THREE from "three";

import { ballThreatensOwnGoal } from "../ai/botTactics";
import type { ScoringTeam } from "../game/modes";
import { RL_ARENA } from "./arenaConstants";

const GOAL_BLUE = new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH);
const GOAL_ORANGE = new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);

export const EPIC_SAVE_IMPACT_MIN = 3.5;
export const EPIC_SAVE_MAX_GOAL_DIST = 28;

export type EpicSavePresentation = {
	flash: number;
	streak: number;
	bloom: number;
	fovBoost: number;
	shake: number;
	label: string;
};

export function ownGoalForTeam(team: ScoringTeam): THREE.Vector3 {
	if (team === "blue") return GOAL_ORANGE;
	if (team === "orange") return GOAL_BLUE;
	return GOAL_ORANGE;
}

/** Piłka leci w bramkę gracza — kontekst epic save. */
export function evaluateEpicSave(
	humanTeam: ScoringTeam | null,
	ballPos: THREE.Vector3,
	ballVelBefore: THREE.Vector3,
	hitImpact: number,
	hitterIsHuman: boolean,
): boolean {
	if (!hitterIsHuman || !humanTeam || hitImpact < EPIC_SAVE_IMPACT_MIN) {
		return false;
	}

	const ownGoal = ownGoalForTeam(humanTeam);
	if (!ballThreatensOwnGoal(ballPos, ballVelBefore, ownGoal, 2.0)) {
		return false;
	}

	return ballPos.distanceTo(ownGoal) <= EPIC_SAVE_MAX_GOAL_DIST;
}

/** Kinowy moment przy obronie własnej bramki. */
export class EpicSaveHighlight {
	private active = false;
	private elapsed = 0;
	private cooldown = 0;
	private intensity = 0;
	private label = "EPIC SAVE";

	trigger(impact: number, ballVelTowardGoal: number): void {
		if (this.cooldown > 0) return;
		this.active = true;
		this.elapsed = 0;
		this.cooldown = 2.6;
		this.intensity = THREE.MathUtils.clamp(
			0.45 + impact * 0.04 + ballVelTowardGoal * 0.06,
			0.45,
			1,
		);
		this.label =
			ballVelTowardGoal >= 8 || impact >= 9 ? "CLUTCH SAVE" : "EPIC SAVE";
	}

	update(dt: number): void {
		this.cooldown = Math.max(0, this.cooldown - dt);
		if (!this.active) return;
		this.elapsed += dt;
		if (this.elapsed >= 0.82) {
			this.active = false;
		}
	}

	isActive(): boolean {
		return this.active;
	}

	getPresentation(): EpicSavePresentation {
		if (!this.active) {
			return {
				flash: 0,
				streak: 0,
				bloom: 0,
				fovBoost: 0,
				shake: 0,
				label: "",
			};
		}

		const t = this.elapsed;
		const k = this.intensity;
		const flash =
			t < 0.05
				? (1 - t / 0.05) * k * 0.85
				: Math.max(0, 0.26 * k * (1 - (t - 0.05) / 0.28));
		const streak =
			t < 0.04 ? (t / 0.04) * k : t < 0.5 ? k * (1 - (t - 0.04) / 0.46) : 0;
		const bloom =
			t < 0.1
				? (t / 0.1) * k * 0.8
				: Math.max(0, k * (1 - (t - 0.1) / 0.52) * 0.65);
		const fovBoost = t < 0.15 ? THREE.MathUtils.lerp(7 * k, 1.5, t / 0.15) : 0;
		const shake = t < 0.3 ? THREE.MathUtils.lerp(0.48 * k, 0.06, t / 0.3) : 0;

		return {
			flash,
			streak,
			bloom,
			fovBoost,
			shake,
			label: this.label,
		};
	}
}

export function applyEpicSaveOverlay(presentation: EpicSavePresentation): void {
	const flashEl = document.getElementById("epic-save-flash");
	const bannerEl = document.getElementById("epic-save-banner");
	if (!flashEl || !bannerEl) return;

	if (presentation.flash <= 0.01 && presentation.streak <= 0.01) {
		flashEl.style.opacity = "0";
		bannerEl.classList.remove("show");
		return;
	}

	flashEl.style.opacity = String(
		THREE.MathUtils.clamp(presentation.flash * 0.82, 0, 1),
	);
	flashEl.style.setProperty(
		"--streak",
		String(THREE.MathUtils.clamp(presentation.streak, 0, 1)),
	);

	if (presentation.label) {
		bannerEl.textContent = presentation.label;
	}

	if (presentation.flash > 0.22 || presentation.streak > 0.38) {
		bannerEl.classList.add("show");
	} else if (presentation.streak <= 0.1) {
		bannerEl.classList.remove("show");
	}
}

/** Prędkość piłki w stronę własnej bramki (m/s, dodatnia = groźba). */
export function ballVelTowardOwnGoal(
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	ownGoal: THREE.Vector3,
): number {
	const dir = ownGoal.clone().sub(ballPos);
	dir.y = 0;
	if (dir.lengthSq() < 1e-6) return 0;
	dir.normalize();
	return ballVel.x * dir.x + ballVel.z * dir.z;
}
