import * as THREE from "three";

import { ballThreatensOwnGoal } from "../ai/botTactics";
import type { ScoringTeam } from "../game/modes";
import { ownGoalForTeam } from "./epicSaveHighlight";

export type SaveAnticipationPresentation = {
	vignette: number;
	pulse: number;
};

/** Subtelny vignette gdy piłka leci w twoją bramkę — przed uderzeniem. */
export class SaveAnticipation {
	private buildup = 0;

	sample(
		humanTeam: ScoringTeam | null,
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		dt: number,
	): void {
		if (!humanTeam || ballVel.lengthSq() < 4) {
			this.buildup = Math.max(0, this.buildup - dt * 2.2);
			return;
		}
		const ownGoal = ownGoalForTeam(humanTeam);
		const dist = ballPos.distanceTo(ownGoal);
		if (dist > 32 || !ballThreatensOwnGoal(ballPos, ballVel, ownGoal, 1.4)) {
			this.buildup = Math.max(0, this.buildup - dt * 2.5);
			return;
		}
		const threat = THREE.MathUtils.clamp(
			(28 - dist) / 22 + ballVel.length() / 28,
			0,
			1,
		);
		this.buildup = THREE.MathUtils.lerp(
			this.buildup,
			threat,
			1 - Math.exp(-6 * dt),
		);
	}

	getPresentation(): SaveAnticipationPresentation {
		if (this.buildup < 0.04) {
			return { vignette: 0, pulse: 0 };
		}
		// Bez winiety — krótki cool flash / pulse zamiast ciemnych rogów.
		return {
			vignette: 0,
			pulse: this.buildup,
		};
	}
}

export function applySaveAnticipationOverlay(
	p: SaveAnticipationPresentation,
): void {
	const el = document.getElementById("save-anticipation-flash");
	if (!el) return;
	if (p.pulse < 0.04) {
		el.style.opacity = "0";
		return;
	}
	el.style.opacity = String(THREE.MathUtils.clamp(p.pulse * 0.28, 0, 0.35));
	el.style.setProperty("--pulse", String(p.pulse));
}
