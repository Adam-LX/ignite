import type { ScoringTeam } from "../game/modes";
import { RL_ARENA } from "../visual/arenaConstants";

export type MinimapEntity = {
	x: number;
	z: number;
	team: ScoringTeam | null;
	isHuman: boolean;
	isBall?: boolean;
};

const STORAGE_KEY = "ignite.minimap";

/** Top-down minimapa boiska — auta + piłka. Domyślnie ukryta (toggle M / przycisk). */
export class MatchMinimap {
	private readonly ctx: CanvasRenderingContext2D;
	private readonly toggleBtn: HTMLButtonElement | null;
	/** Czy mecz chce pokazać minimapę (nie FFA / nie meridian / nie finished). */
	private matchWantsVisible = false;
	/** Preferencja gracza — domyślnie wyłączona. */
	private userEnabled = localStorage.getItem(STORAGE_KEY) === "1";

	constructor(
		private readonly canvas: HTMLCanvasElement = document.getElementById(
			"match-minimap",
		) as HTMLCanvasElement,
	) {
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("MatchMinimap: brak kontekstu 2D");
		this.ctx = ctx;
		this.toggleBtn = document.getElementById(
			"minimap-toggle",
		) as HTMLButtonElement | null;
		this.toggleBtn?.addEventListener("click", () => {
			this.toggleUserEnabled();
		});
		this.syncDom();
	}

	isUserEnabled(): boolean {
		return this.userEnabled;
	}

	toggleUserEnabled(): boolean {
		this.userEnabled = !this.userEnabled;
		try {
			localStorage.setItem(STORAGE_KEY, this.userEnabled ? "1" : "0");
		} catch {
			/* private mode */
		}
		this.syncDom();
		return this.userEnabled;
	}

	setVisible(active: boolean): void {
		this.matchWantsVisible = active;
		this.syncDom();
		if (!this.isDrawn()) {
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		}
	}

	private isDrawn(): boolean {
		return this.matchWantsVisible && this.userEnabled;
	}

	private syncDom(): void {
		const showWrap = this.matchWantsVisible;
		const wrap = document.getElementById("match-minimap-wrap");
		if (wrap) wrap.classList.toggle("hidden", !showWrap);
		this.canvas.classList.toggle("hidden", !this.isDrawn());
		if (this.toggleBtn) {
			this.toggleBtn.hidden = !showWrap;
			this.toggleBtn.setAttribute(
				"aria-pressed",
				this.userEnabled ? "true" : "false",
			);
		}
	}

	draw(
		entities: MinimapEntity[],
		lastTouchTeam: ScoringTeam | null,
		humanTeam: ScoringTeam | null,
	): void {
		if (!this.isDrawn()) return;

		const { width, height } = this.canvas;
		const ctx = this.ctx;
		ctx.clearRect(0, 0, width, height);

		this.drawField(ctx, width, height);
		this.drawGoals(ctx, width, height);

		const ball = entities.find((e) => e.isBall);
		for (const entity of entities) {
			if (entity.isBall) continue;
			this.drawCar(ctx, entity, width, height);
		}
		if (ball) {
			this.drawBall(ctx, ball, lastTouchTeam, width, height);
		}

		if (humanTeam) {
			const tag = humanTeam === "blue" ? "BLUE" : "ORANGE";
			ctx.font = "600 9px Orbitron, system-ui, sans-serif";
			ctx.fillStyle = "rgba(255,255,255,0.55)";
			ctx.textAlign = "left";
			ctx.fillText(tag, 6, height - 6);
		}
	}

	private drawField(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
	): void {
		ctx.fillStyle = "rgba(4, 14, 28, 0.92)";
		ctx.fillRect(0, 0, width, height);

		ctx.strokeStyle = "rgba(61, 255, 232, 0.08)";
		ctx.lineWidth = 1;
		for (let i = 1; i < 4; i++) {
			const y = (height * i) / 4;
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
			ctx.stroke();
		}
		for (let i = 1; i < 3; i++) {
			const x = (width * i) / 3;
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
			ctx.stroke();
		}

		ctx.strokeStyle = "rgba(255,255,255,0.14)";
		ctx.lineWidth = 1.2;
		ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

		const cx = width * 0.5;
		const cy = height * 0.5;
		ctx.beginPath();
		ctx.arc(cx, cy, Math.min(width, height) * 0.11, 0, Math.PI * 2);
		ctx.stroke();
	}

	private drawGoals(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
	): void {
		const gw = (RL_ARENA.GOAL_WIDTH / RL_ARENA.WIDTH) * width;
		const gx = (width - gw) * 0.5;
		const gh = (RL_ARENA.GOAL_DEPTH / RL_ARENA.LENGTH) * height * 0.55;

		ctx.fillStyle = "rgba(80, 180, 255, 0.14)";
		ctx.fillRect(gx, 0, gw, gh);
		ctx.fillStyle = "rgba(255, 120, 60, 0.14)";
		ctx.fillRect(gx, height - gh, gw, gh);
	}

	private drawCar(
		ctx: CanvasRenderingContext2D,
		entity: MinimapEntity,
		width: number,
		height: number,
	): void {
		const p = worldToMinimap(entity.x, entity.z, width, height);
		const color =
			entity.team === "blue"
				? "#5eb8ff"
				: entity.team === "orange"
					? "#ff8844"
					: "#c8d4e8";
		const r = entity.isHuman ? 4.2 : 3.2;

		ctx.beginPath();
		ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
		ctx.fillStyle = color;
		ctx.fill();

		if (entity.isHuman) {
			ctx.strokeStyle = "rgba(255,255,255,0.95)";
			ctx.lineWidth = 1.4;
			ctx.stroke();
		}
	}

	private drawBall(
		ctx: CanvasRenderingContext2D,
		ball: MinimapEntity,
		lastTouchTeam: ScoringTeam | null,
		width: number,
		height: number,
	): void {
		const p = worldToMinimap(ball.x, ball.z, width, height);
		const tint =
			lastTouchTeam === "blue"
				? "#66d8ff"
				: lastTouchTeam === "orange"
					? "#ffaa66"
					: "#ffffff";

		ctx.beginPath();
		ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
		ctx.fillStyle = tint;
		ctx.fill();
		ctx.strokeStyle = "rgba(255,255,255,0.9)";
		ctx.lineWidth = 1.2;
		ctx.stroke();
	}
}

export function worldToMinimap(
	x: number,
	z: number,
	width: number,
	height: number,
): { x: number; y: number } {
	const nx = (x + RL_ARENA.HALF_WIDTH) / RL_ARENA.WIDTH;
	const nz = (z + RL_ARENA.HALF_LENGTH) / RL_ARENA.LENGTH;
	return {
		x: nx * width,
		y: nz * height,
	};
}
