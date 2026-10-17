import * as THREE from "three";

import type { ScoringTeam } from "../game/modes";
import { ballPaletteForTeam } from "../visual/ballTeamVisual";

export const BALL_OFFSCREEN_EDGE_MARGIN = 0.88;
export const BALL_OFFSCREEN_NDC_MARGIN = 0.08;

/**
 * NDC → krawędź ekranu (sx/sy w [-edge,+edge]).
 * z>1 = za kamerą → flip osi (strzałka w stronę piłki).
 * null = w kadrze (z w [-1,1] i |x|,|y| w marginesie).
 */
export function ballOffScreenEdgeNdc(
	ndcX: number,
	ndcY: number,
	ndcZ: number,
	ndcMargin = BALL_OFFSCREEN_NDC_MARGIN,
	edgeMargin = BALL_OFFSCREEN_EDGE_MARGIN,
): { sx: number; sy: number; angleDeg: number } | null {
	const onScreen =
		ndcZ >= -1 &&
		ndcZ <= 1 &&
		Math.abs(ndcX) <= 1 - ndcMargin &&
		Math.abs(ndcY) <= 1 - ndcMargin;
	if (onScreen) return null;

	let sx = ndcX;
	let sy = ndcY;
	if (ndcZ > 1) {
		sx = -sx;
		sy = -sy;
	}

	const absX = Math.abs(sx);
	const absY = Math.abs(sy);
	const edgeScale = edgeMargin / Math.max(absX, absY, 1e-4);
	sx *= edgeScale;
	sy *= edgeScale;

	const angleRad = Math.atan2(sy, sx);
	const angleDeg = (angleRad * 180) / Math.PI + 90;
	return { sx, sy, angleDeg };
}

/**
 * 2D strzałka na krawędzi ekranu gdy piłka poza kadrem (tylko bez Ball Cam).
 */
export class BallOffScreenIndicator {
	private readonly root: HTMLElement;
	private readonly arrow: HTMLElement;
	private readonly ndcScratch = new THREE.Vector3();
	private pulsePhase = 0;
	private teamTint = "#44ffee";

	setTeamTint(team: ScoringTeam | null): void {
		const palette = ballPaletteForTeam(team);
		this.teamTint = `#${palette.emissive.toString(16).padStart(6, "0")}`;
	}

	constructor(root: HTMLElement = document.getElementById("ball-offscreen")!) {
		const arrow = root.querySelector<HTMLElement>("#ball-offscreen-arrow");
		if (!arrow)
			throw new Error("BallOffScreenIndicator: brak #ball-offscreen-arrow");
		this.root = root;
		this.arrow = arrow;
		this.hide();
	}

	update(
		ballPos: THREE.Vector3,
		camera: THREE.PerspectiveCamera,
		ballCamEnabled: boolean,
		dt: number,
	): void {
		if (ballCamEnabled) {
			this.hide();
			return;
		}

		camera.updateMatrixWorld(true);
		this.ndcScratch.copy(ballPos).project(camera);

		const edge = ballOffScreenEdgeNdc(
			this.ndcScratch.x,
			this.ndcScratch.y,
			this.ndcScratch.z,
		);
		if (!edge) {
			this.hide();
			return;
		}

		const { sx, sy, angleDeg } = edge;
		const w = window.innerWidth;
		const h = window.innerHeight;
		const px = (sx * 0.5 + 0.5) * w;
		const py = (-sy * 0.5 + 0.5) * h;

		this.pulsePhase += dt;
		const pulse = 0.9 + Math.sin(this.pulsePhase * 5.2) * 0.1;

		this.root.classList.add("show");
		this.root.style.left = `${px}px`;
		this.root.style.top = `${py}px`;
		this.root.style.setProperty("--ball-arrow-color", this.teamTint);
		this.arrow.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg) scale(${pulse})`;
	}

	hide(): void {
		this.root.classList.remove("show");
	}

	dispose(): void {
		this.hide();
	}
}
