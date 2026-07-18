import * as THREE from "three";
import { t } from "../i18n";
import type { ScoreboardRow } from "../match/MatchScoring";

const CANVAS_W = 1280;
const CANVAS_H = 720;
const PLANE_W = 18;
const PLANE_D = 10.2;

/** Tab scoreboard — płaszczyzna wtopiona w murawę (środek boiska). */
export class MatchScoreboardPitch {
	private readonly root = new THREE.Group();
	private readonly mesh: THREE.Mesh;
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;
	private readonly texture: THREE.CanvasTexture;

	constructor(scene: THREE.Scene) {
		this.root.name = "matchScoreboardPitch";
		this.root.position.set(0, 0.062, 0);

		this.canvas = document.createElement("canvas");
		this.canvas.width = CANVAS_W;
		this.canvas.height = CANVAS_H;
		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas 2D unavailable");
		this.ctx = ctx;

		this.texture = new THREE.CanvasTexture(this.canvas);
		this.texture.colorSpace = THREE.SRGBColorSpace;
		this.texture.minFilter = THREE.LinearFilter;
		this.texture.magFilter = THREE.LinearFilter;

		const mat = new THREE.MeshBasicMaterial({
			map: this.texture,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_D), mat);
		this.mesh.rotation.x = -Math.PI / 2;
		this.mesh.renderOrder = 4;
		this.mesh.frustumCulled = false;
		this.root.add(this.mesh);
		scene.add(this.root);
		this.root.visible = false;
	}

	update(rows: ScoreboardRow[], visible: boolean, humanSlot: number): void {
		this.root.visible = visible;
		if (!visible) return;
		this.draw(rows, humanSlot);
		this.texture.needsUpdate = true;
	}

	private draw(rows: ScoreboardRow[], humanSlot: number): void {
		const ctx = this.ctx;
		ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

		const pad = 36;
		const panelW = CANVAS_W - pad * 2;
		const panelH = CANVAS_H - pad * 2;

		ctx.save();
		ctx.shadowColor = "rgba(0,0,0,0.55)";
		ctx.shadowBlur = 28;
		ctx.fillStyle = "rgba(6, 12, 26, 0.88)";
		roundRect(ctx, pad, pad, panelW, panelH, 18);
		ctx.fill();
		ctx.shadowBlur = 0;

		ctx.strokeStyle = "rgba(255,255,255,0.14)";
		ctx.lineWidth = 2;
		roundRect(ctx, pad, pad, panelW, panelH, 18);
		ctx.stroke();

		ctx.fillStyle = "rgba(220, 238, 255, 0.94)";
		ctx.font = "bold 34px system-ui, sans-serif";
		ctx.textAlign = "center";
		ctx.fillText(t("scoreboard.title").toUpperCase(), CANVAS_W / 2, pad + 52);

		const cols = [
			t("scoreboard.player"),
			t("scoreboard.score"),
			t("scoreboard.goals"),
			t("scoreboard.assists"),
			t("scoreboard.saves"),
			t("scoreboard.centers"),
			t("scoreboard.touches"),
			t("scoreboard.shots"),
		];
		const colX = [pad + 24, 520, 620, 700, 780, 860, 940, 1020];
		ctx.font = "600 20px system-ui, sans-serif";
		ctx.fillStyle = "rgba(160, 190, 220, 0.82)";
		ctx.textAlign = "left";
		for (let i = 0; i < cols.length; i++) {
			ctx.fillText(cols[i]!.toUpperCase(), colX[i]!, pad + 96);
		}

		ctx.strokeStyle = "rgba(255,255,255,0.08)";
		ctx.beginPath();
		ctx.moveTo(pad + 12, pad + 112);
		ctx.lineTo(pad + panelW - 12, pad + 112);
		ctx.stroke();

		const rowH = 54;
		let y = pad + 138;
		for (const row of rows) {
			const isYou = row.slotIndex === humanSlot;
			const teamColor =
				row.team === "blue"
					? "rgba(77, 168, 255, 0.22)"
					: row.team === "orange"
						? "rgba(255, 138, 61, 0.2)"
						: "rgba(255,255,255,0.04)";
			ctx.fillStyle = isYou ? "rgba(255,255,255,0.1)" : teamColor;
			roundRect(ctx, pad + 10, y - 34, panelW - 20, rowH - 6, 10);
			ctx.fill();

			ctx.fillStyle =
				row.team === "blue"
					? "#9ed8ff"
					: row.team === "orange"
						? "#ffc898"
						: "#eef4ff";
			ctx.font = isYou ? "800 24px system-ui" : "700 22px system-ui";
			const label = row.name + (isYou ? ` · ${t("scoreboard.you")}` : "");
			ctx.fillText(label, colX[0]!, y);

			const stats = [
				row.score,
				row.goals,
				row.assists,
				row.saves,
				row.centers,
				row.touches,
				row.shots,
			];
			ctx.font = "700 22px system-ui";
			ctx.fillStyle = "rgba(235, 245, 255, 0.92)";
			for (let i = 0; i < stats.length; i++) {
				ctx.textAlign = "center";
				ctx.fillText(String(stats[i]), colX[i + 1]! + 28, y);
			}
			ctx.textAlign = "left";
			y += rowH;
		}

		ctx.fillStyle = "rgba(150, 175, 205, 0.72)";
		ctx.font = "600 18px system-ui";
		ctx.textAlign = "center";
		ctx.fillText(t("scoreboard.hint"), CANVAS_W / 2, pad + panelH - 18);
		ctx.restore();
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		(this.mesh.material as THREE.Material).dispose();
		this.texture.dispose();
		this.root.removeFromParent();
	}
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	const rr = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + rr, y);
	ctx.lineTo(x + w - rr, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
	ctx.lineTo(x + w, y + h - rr);
	ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
	ctx.lineTo(x + rr, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
	ctx.lineTo(x, y + rr);
	ctx.quadraticCurveTo(x, y, x + rr, y);
	ctx.closePath();
}
