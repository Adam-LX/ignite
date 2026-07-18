import * as THREE from "three";

import type { ScoringTeam } from "../game/modes";
import { ballPaletteForTeam } from "../visual/ballTeamVisual";

const EDGE_MARGIN = 0.88;
const NDC_MARGIN = 0.08;

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

		const onScreen =
			this.ndcScratch.z >= -1 &&
			this.ndcScratch.z <= 1 &&
			Math.abs(this.ndcScratch.x) <= 1 - NDC_MARGIN &&
			Math.abs(this.ndcScratch.y) <= 1 - NDC_MARGIN;

		if (onScreen) {
			this.hide();
			return;
		}

		let sx = this.ndcScratch.x;
		let sy = this.ndcScratch.y;
		if (this.ndcScratch.z > 1) {
			sx = -sx;
			sy = -sy;
		}

		const absX = Math.abs(sx);
		const absY = Math.abs(sy);
		const edgeScale = EDGE_MARGIN / Math.max(absX, absY, 1e-4);
		sx *= edgeScale;
		sy *= edgeScale;

		const w = window.innerWidth;
		const h = window.innerHeight;
		const px = (sx * 0.5 + 0.5) * w;
		const py = (-sy * 0.5 + 0.5) * h;

		const angleRad = Math.atan2(sy, sx);
		const angleDeg = (angleRad * 180) / Math.PI + 90;

		this.pulsePhase += dt;
		const pulse = 0.82 + Math.sin(this.pulsePhase * 7.5) * 0.18;

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
