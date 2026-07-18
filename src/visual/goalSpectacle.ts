import * as THREE from "three";

import type { ScoringTeam } from "../game/modes";
import { getGoalExplosionEntry } from "../meta/CosmeticCatalog";
import {
	getEquippedGoalExplosionId,
	getEquippedPaintId,
} from "../meta/PlayerInventory";
import { getGoalExplosionPaintHueShift } from "./applyPaintCosmetic";

const SPECTACLE_DURATION = 2.95;
const SPECTACLE_DURATION_REDUCED = 1.45;
const SKIP_UNLOCK_SEC = 1;
const TEAM_GRADE_WINDOW = 0.6;
const ORBIT_MAX_RAD = Math.PI;

export type GoalSpectacleTriggerOpts = {
	durationSec?: number;
	/** reduced cinematic — krócej, bez pełnej orbity. */
	reduced?: boolean;
	/** Loadout strzelającego (nie zawsze human equipped). */
	explosionId?: string;
	paintId?: string | null;
};

export type GoalSpectacleCameraPose = {
	eye: THREE.Vector3;
	lookAt: THREE.Vector3;
	orbitNorm: number;
};

/** Kinetyka gola — slow-mo, flash, bloom, FOV punch, orbit 180°, skip. */
export class GoalSpectacle {
	private active = false;
	private elapsed = 0;
	private duration = SPECTACLE_DURATION;
	private team: ScoringTeam | null = null;
	private replayMode = false;
	private replayGoalCrossNorm = 0.72;
	private replayCrossConsumed = false;
	private reduced = false;
	private fxMul = {
		flash: 1,
		bloom: 1,
		chromatic: 1,
		shake: 1,
		vignette: 1,
	};
	readonly goalPos = new THREE.Vector3();
	private readonly _eye = new THREE.Vector3();
	private readonly _look = new THREE.Vector3();

	private paintHueShift = 0;

	private loadFxPreset(explosionId?: string, paintId?: string | null): void {
		const id = explosionId ?? getEquippedGoalExplosionId();
		const entry = getGoalExplosionEntry(id);
		this.fxMul = {
			flash: entry?.flashMul ?? 1,
			bloom: entry?.bloomMul ?? 1,
			chromatic: entry?.chromaticMul ?? 1,
			shake: entry?.shakeMul ?? 1,
			vignette: entry?.vignetteMul ?? 1,
		};
		const paint =
			paintId === undefined
				? getEquippedPaintId("goalExplosion")
				: paintId;
		this.paintHueShift = getGoalExplosionPaintHueShift(paint);
	}

	trigger(
		team: ScoringTeam,
		goalPos: THREE.Vector3,
		durationOrOpts: number | GoalSpectacleTriggerOpts = SPECTACLE_DURATION,
	): void {
		const opts: GoalSpectacleTriggerOpts =
			typeof durationOrOpts === "number"
				? { durationSec: durationOrOpts }
				: durationOrOpts;
		this.reduced = opts.reduced === true;
		this.loadFxPreset(opts.explosionId, opts.paintId);
		this.active = true;
		this.elapsed = 0;
		const base =
			opts.durationSec ??
			(this.reduced ? SPECTACLE_DURATION_REDUCED : SPECTACLE_DURATION);
		this.duration = Math.max(0.35, base);
		this.team = team;
		this.replayMode = false;
		this.replayCrossConsumed = false;
		this.goalPos.copy(goalPos);
	}

	/** Replay — bez HTML/bloom; tylko sygnał do lokalnego goalVfx przy bramce. */
	triggerForReplay(
		team: ScoringTeam,
		goalPos: THREE.Vector3,
		goalCrossNorm = 0.72,
	): void {
		this.active = true;
		this.replayMode = true;
		this.reduced = false;
		this.replayGoalCrossNorm = goalCrossNorm;
		this.replayCrossConsumed = false;
		this.elapsed = 0;
		this.team = team;
		this.goalPos.copy(goalPos);
	}

	/** Jednorazowy impuls 3D przy momencie bramki w klipie. */
	consumeReplayGoalCross(progress: number): ScoringTeam | null {
		if (!this.active || !this.replayMode || this.replayCrossConsumed) return null;
		if (progress + 0.004 >= this.replayGoalCrossNorm) {
			this.replayCrossConsumed = true;
			return this.team;
		}
		return null;
	}

	endReplay(): void {
		this.active = false;
		this.replayMode = false;
		this.replayCrossConsumed = false;
		this.team = null;
		clearGoalSpectacleOverlay();
	}

	/** Skip po ≥1 s — przyspiesza do końca sekwencji. */
	canSkip(): boolean {
		return (
			this.isPresentationActive() && this.elapsed >= SKIP_UNLOCK_SEC
		);
	}

	skip(): boolean {
		if (!this.canSkip()) return false;
		this.elapsed = Math.max(this.elapsed, this.duration - 0.12);
		return true;
	}

	/** Natychmiast kończy spektakl (DEV audit / emergency). */
	forceEnd(): void {
		this.active = false;
		this.replayMode = false;
		this.replayCrossConsumed = false;
		this.team = null;
		this.elapsed = 0;
		clearGoalSpectacleOverlay();
	}

	getElapsed(): number {
		return this.elapsed;
	}

	isReduced(): boolean {
		return this.reduced;
	}

	isActive(): boolean {
		return this.active;
	}

	isPresentationActive(): boolean {
		if (!this.active || this.replayMode) return false;
		return this.elapsed < this.duration;
	}

	getTeam(): ScoringTeam | null {
		return this.team;
	}

	update(dt: number): void {
		if (!this.active || this.replayMode) return;
		this.elapsed += dt;
		if (this.elapsed >= this.duration) {
			this.active = false;
			this.team = null;
		}
	}

	getSimTimeScale(): number {
		if (!this.active || this.replayMode) return 1;
		const scale = this.reduced ? 0.55 : 1;
		const t = this.elapsed;
		if (t < 0.72 * scale + (1 - scale) * 0.2) {
			const end = 0.72 * (this.reduced ? 0.7 : 1);
			return THREE.MathUtils.lerp(0.08, 0.38, smoothstep(0, end, t));
		}
		if (t < 1.35 * (this.reduced ? 0.75 : 1)) {
			const a = 0.72 * (this.reduced ? 0.7 : 1);
			const b = 1.35 * (this.reduced ? 0.75 : 1);
			return THREE.MathUtils.lerp(0.38, 1, smoothstep(a, b, t));
		}
		return 1;
	}

	/**
	 * Orbit do 180° wokół goalPos (v2). reduced → statyczny wide shot.
	 */
	getCameraPose(): GoalSpectacleCameraPose | null {
		if (!this.isPresentationActive()) return null;
		const focus = this.goalPos;
		if (this.reduced) {
			this._eye.set(focus.x + 10, focus.y + 5.2, focus.z + 8);
			this._look.copy(focus);
			return {
				eye: this._eye.clone(),
				lookAt: this._look.clone(),
				orbitNorm: 0,
			};
		}
		const norm = THREE.MathUtils.clamp(this.elapsed / this.duration, 0, 1);
		const a = norm * ORBIT_MAX_RAD;
		const r = 11 + Math.sin(a * 0.5) * 2;
		const y = 5.5 + Math.sin(a * 0.85) * 1.4;
		this._eye.set(
			focus.x + Math.sin(a) * r,
			focus.y + y,
			focus.z + Math.cos(a) * r,
		);
		this._look.copy(focus);
		return {
			eye: this._eye.clone(),
			lookAt: this._look.clone(),
			orbitNorm: norm,
		};
	}

	getPresentation(): GoalSpectaclePresentation {
		if (!this.isPresentationActive()) {
			return emptyPresentation();
		}

		const t = this.elapsed;
		const flash =
			t < 0.06
				? 1.05 - (t / 0.06) * 0.35
				: t < 0.28
					? 0.7 * (1 - smoothstep(0.06, 0.28, t))
					: 0;
		// Team wash (środek) — pole `vignette` w API; CSS to glow, nie ciemne rogi.
		const vignette =
			t < 0.1
				? smoothstep(0, 0.1, t) * 0.55
				: t < 0.5
					? 0.55 * (1 - smoothstep(0.1, 0.5, t))
					: 0;
		const bloom =
			t < 0.12
				? smoothstep(0, 0.12, t) * 0.72
				: 0.72 - smoothstep(0.12, 0.78, t) * 0.72;
		const fovBoost =
			t < 0.2
				? THREE.MathUtils.lerp(18, 8, smoothstep(0, 0.2, t))
				: Math.max(0, 8 * (1 - smoothstep(0.2, 0.85, t)));
		const shake =
			t < 0.28 ? THREE.MathUtils.lerp(0.28, 0.04, smoothstep(0, 0.28, t)) : 0;
		const dofFocus =
			t < 0.08
				? smoothstep(0, 0.08, t) * 0.75
				: t < 1.2
					? 0.75 - smoothstep(0.45, 1.2, t) * 0.75
					: 0;
		const chromatic =
			t < 0.08
				? smoothstep(0, 0.08, t) * 0.95
				: Math.max(0, 0.95 * (1 - smoothstep(0.08, 0.32, t)));
		const paintBloom =
			this.paintHueShift > 0 ? 1 + Math.sin(this.paintHueShift) * 0.08 : 1;

		const grade =
			t < TEAM_GRADE_WINDOW
				? 1 - smoothstep(0, TEAM_GRADE_WINDOW, t)
				: 0;
		const coolGrade = this.team === "blue" ? grade : 0;
		const warmGrade = this.team === "orange" ? grade : 0;

		const fxScale = this.reduced ? 0.72 : 1;

		return {
			flash: flash * this.fxMul.flash * fxScale,
			vignette: vignette * this.fxMul.vignette * fxScale,
			bloom: bloom * this.fxMul.bloom * paintBloom * fxScale,
			fovBoost: fovBoost * fxScale,
			shake: shake * this.fxMul.shake * fxScale,
			dofFocus: dofFocus * fxScale,
			chromatic: chromatic * this.fxMul.chromatic * fxScale,
			team: this.team,
			coolGrade,
			warmGrade,
		};
	}
}

export type GoalSpectaclePresentation = {
	flash: number;
	vignette: number;
	bloom: number;
	fovBoost: number;
	shake: number;
	dofFocus: number;
	chromatic: number;
	team: ScoringTeam | null;
	coolGrade: number;
	warmGrade: number;
};

export function emptyGoalPresentation(): GoalSpectaclePresentation {
	return {
		flash: 0,
		vignette: 0,
		bloom: 0,
		fovBoost: 0,
		shake: 0,
		dofFocus: 0,
		chromatic: 0,
		team: null,
		coolGrade: 0,
		warmGrade: 0,
	};
}

function emptyPresentation(): GoalSpectaclePresentation {
	return emptyGoalPresentation();
}

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
		flashEl.style.setProperty("--chromatic", "0");
		return;
	}

	if (presentation.team) {
		flashEl.dataset.team = presentation.team;
		vignetteEl.dataset.team = presentation.team;
	}

	flashEl.style.opacity = String(
		THREE.MathUtils.clamp(presentation.flash, 0, 1.15),
	);
	flashEl.style.setProperty(
		"--chromatic",
		String(THREE.MathUtils.clamp(presentation.chromatic, 0, 1)),
	);
	vignetteEl.style.opacity = String(
		THREE.MathUtils.clamp(presentation.vignette * 1.05, 0, 1),
	);
}

export function clearGoalSpectacleOverlay(): void {
	applyGoalSpectacleOverlay(emptyPresentation());
}
