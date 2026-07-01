import * as THREE from "three";

import type { ScoringTeam } from "../game/modes";

const SPECTACLE_DURATION = 2.35;
const REPLAY_SPECTACLE_DURATION = 7.5;

/** Kinetyka gola — slow-mo na boisku, flash, bloom, FOV punch. */
export class GoalSpectacle {
	private active = false;
	private elapsed = 0;
	private duration = SPECTACLE_DURATION;
	private team: ScoringTeam | null = null;
	readonly goalPos = new THREE.Vector3();

	trigger(
		team: ScoringTeam,
		goalPos: THREE.Vector3,
		durationSec = SPECTACLE_DURATION,
	): void {
		this.active = true;
		this.elapsed = 0;
		this.duration = Math.max(0.35, durationSec);
		this.team = team;
		this.goalPos.copy(goalPos);
	}

	/** Utrzymuje efekt przez cały replay (flash/vignette/bloom). */
	triggerForReplay(team: ScoringTeam, goalPos: THREE.Vector3): void {
		this.trigger(team, goalPos, REPLAY_SPECTACLE_DURATION);
	}

	isActive(): boolean {
		return this.active;
	}

	getTeam(): ScoringTeam | null {
		return this.team;
	}

	update(dt: number): void {
		if (!this.active) return;
		this.elapsed += dt;
		if (this.elapsed >= this.duration) {
			this.active = false;
			this.team = null;
		}
	}

	/** Skala czasu symulacji w fazie goal_bounce (0.15–1). */
	getSimTimeScale(): number {
		if (!this.active) return 1;
		const t = this.elapsed;
		if (t < 0.55) {
			return THREE.MathUtils.lerp(0.15, 0.42, smoothstep(0, 0.55, t));
		}
		if (t < 1.05) {
			return THREE.MathUtils.lerp(0.42, 1, smoothstep(0.55, 1.05, t));
		}
		return 1;
	}

	getPresentation(): GoalSpectaclePresentation {
		if (!this.active) {
			return {
				flash: 0,
				vignette: 0,
				bloom: 0,
				fovBoost: 0,
				shake: 0,
				team: null,
			};
		}

		const t = this.elapsed;
		const flash =
			t < 0.12
				? 1 - t / 0.12
				: t < 0.45
					? 0.22 * (1 - smoothstep(0.12, 0.45, t))
					: 0;
		const vignette =
			t < 0.08
				? smoothstep(0, 0.08, t)
				: t < 1.85
					? 1 - smoothstep(1.35, 1.85, t) * 0.55
					: 0.45 * (1 - smoothstep(1.85, this.duration, t));
		const bloom =
			t < 0.35 ? smoothstep(0, 0.35, t) : 1 - smoothstep(0.35, 1.5, t) * 0.65;
		const fovBoost =
			t < 0.2
				? THREE.MathUtils.lerp(14, 6, smoothstep(0, 0.2, t))
				: Math.max(0, 6 * (1 - smoothstep(0.2, 0.85, t)));
		const shake =
			t < 0.55 ? THREE.MathUtils.lerp(0.95, 0.18, smoothstep(0, 0.55, t)) : 0;

		return {
			flash,
			vignette,
			bloom,
			fovBoost,
			shake,
			team: this.team,
		};
	}
}

export type GoalSpectaclePresentation = {
	flash: number;
	vignette: number;
	bloom: number;
	fovBoost: number;
	shake: number;
	team: ScoringTeam | null;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}

export function applyGoalSpectacleOverlay(
	presentation: GoalSpectaclePresentation,
): void {
	const flashEl = document.getElementById("goal-spectacle-flash");
	const vignetteEl = document.getElementById("goal-spectacle-vignette");
	if (!flashEl || !vignetteEl) return;

	if (presentation.flash <= 0.01 && presentation.vignette <= 0.01) {
		flashEl.style.opacity = "0";
		vignetteEl.style.opacity = "0";
		flashEl.removeAttribute("data-team");
		vignetteEl.removeAttribute("data-team");
		return;
	}

	if (presentation.team) {
		flashEl.dataset.team = presentation.team;
		vignetteEl.dataset.team = presentation.team;
	}

	flashEl.style.opacity = String(
		THREE.MathUtils.clamp(presentation.flash, 0, 1),
	);
	vignetteEl.style.opacity = String(
		THREE.MathUtils.clamp(presentation.vignette * 0.92, 0, 1),
	);
}
