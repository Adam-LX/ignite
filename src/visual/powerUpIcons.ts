import type { PowerUpKind } from "../modes/IgnitionManager";
import type { PowerUpVisualKind } from "./powerUpVisuals";

/** Id symbolu SVG w index.html (`#powerup-icon-magnet` …). */
export function powerUpIconSymbolId(kind: PowerUpVisualKind): string {
	return `powerup-icon-${kind}`;
}

export function powerUpNeedsReticle(
	held: PowerUpKind | null,
	activeKind: PowerUpKind | null,
): boolean {
	if (held === "magnet" || held === "plunger" || held === "haymaker") {
		return true;
	}
	return activeKind === "magnet" || activeKind === "plunger";
}

/** Rysuje ikonę power-upu na canvas (HUD VFX / sprite). */
export function drawPowerUpIcon(
	ctx: CanvasRenderingContext2D,
	kind: PowerUpVisualKind,
	size: number,
	color: string,
): void {
	const s = size;
	ctx.save();
	ctx.translate(s / 2, s / 2);
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineWidth = Math.max(2, s * 0.07);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	switch (kind) {
		case "magnet":
			drawMagnetIcon(ctx, s, color);
			break;
		case "plunger":
			drawPlungerIcon(ctx, s, color);
			break;
		case "haymaker":
			drawHaymakerIcon(ctx, s, color);
			break;
		case "spikes":
			drawSpikesIcon(ctx, s, color);
			break;
		case "charging":
			drawChargingIcon(ctx, s, color);
			break;
	}

	ctx.restore();
}

function drawMagnetIcon(
	ctx: CanvasRenderingContext2D,
	s: number,
	color: string,
): void {
	const r = s * 0.22;
	ctx.beginPath();
	ctx.arc(-r * 0.9, r * 0.15, r, Math.PI * 0.55, Math.PI * 1.45);
	ctx.arc(r * 0.9, r * 0.15, r, Math.PI * 1.55, Math.PI * 0.45);
	ctx.stroke();
	ctx.fillStyle = "#ff5566";
	ctx.beginPath();
	ctx.arc(-r * 0.9, -r * 0.55, r * 0.34, 0, Math.PI * 2);
	ctx.arc(r * 0.9, -r * 0.55, r * 0.34, 0, Math.PI * 2);
	ctx.fill();
	ctx.strokeStyle = color;
	ctx.lineWidth = Math.max(1.5, s * 0.04);
	ctx.stroke();
}

function drawPlungerIcon(
	ctx: CanvasRenderingContext2D,
	s: number,
	color: string,
): void {
	const cupR = s * 0.2;
	ctx.beginPath();
	ctx.ellipse(0, s * 0.14, cupR, cupR * 0.55, 0, 0, Math.PI * 2);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(0, s * 0.14);
	ctx.lineTo(0, -s * 0.28);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(-s * 0.12, -s * 0.28);
	ctx.lineTo(s * 0.12, -s * 0.28);
	ctx.stroke();
	ctx.fillStyle = color;
	ctx.globalAlpha = 0.35;
	ctx.beginPath();
	ctx.ellipse(0, s * 0.14, cupR * 0.65, cupR * 0.35, 0, 0, Math.PI * 2);
	ctx.fill();
}

function drawHaymakerIcon(
	ctx: CanvasRenderingContext2D,
	s: number,
	color: string,
): void {
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.roundRect(-s * 0.22, -s * 0.08, s * 0.34, s * 0.28, s * 0.06);
	ctx.fill();
	ctx.beginPath();
	ctx.roundRect(s * 0.02, -s * 0.2, s * 0.2, s * 0.36, s * 0.05);
	ctx.fill();
	ctx.strokeStyle = color;
	ctx.globalAlpha = 0.55;
	ctx.lineWidth = Math.max(1.5, s * 0.05);
	for (let i = 0; i < 3; i++) {
		const x = s * 0.06 + i * s * 0.055;
		ctx.beginPath();
		ctx.moveTo(x, -s * 0.16);
		ctx.lineTo(x, s * 0.12);
		ctx.stroke();
	}
}

function drawSpikesIcon(
	ctx: CanvasRenderingContext2D,
	s: number,
	color: string,
): void {
	ctx.fillStyle = color;
	const baseY = s * 0.12;
	const spikes = 5;
	const span = s * 0.42;
	for (let i = 0; i < spikes; i++) {
		const t = i / (spikes - 1);
		const x = -span / 2 + t * span;
		const h = s * (0.22 + (i === 2 ? 0.1 : 0));
		ctx.beginPath();
		ctx.moveTo(x, baseY);
		ctx.lineTo(x - s * 0.06, baseY);
		ctx.lineTo(x, baseY - h);
		ctx.lineTo(x + s * 0.06, baseY);
		ctx.closePath();
		ctx.fill();
	}
	ctx.fillRect(-span / 2, baseY, span, s * 0.05);
}

function drawChargingIcon(
	ctx: CanvasRenderingContext2D,
	s: number,
	color: string,
): void {
	ctx.strokeStyle = color;
	ctx.lineWidth = Math.max(2, s * 0.065);
	ctx.beginPath();
	ctx.arc(0, 0, s * 0.24, Math.PI * 0.15, Math.PI * 1.65);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(s * 0.17, -s * 0.08);
	ctx.lineTo(s * 0.26, s * 0.02);
	ctx.lineTo(s * 0.14, s * 0.02);
	ctx.stroke();
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.moveTo(-s * 0.04, -s * 0.2);
	ctx.lineTo(s * 0.1, -s * 0.2);
	ctx.lineTo(-s * 0.02, s * 0.2);
	ctx.lineTo(s * 0.08, s * 0.2);
	ctx.closePath();
	ctx.fill();
}
