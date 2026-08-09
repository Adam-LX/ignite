/**
 * Centrum boiska — logo IGN!TE z SVG (vtracer) + fallback Wallpoet (OFL).
 */

import { assetUrl } from "../util/assetUrl";

const LOGO_TEXT = "IGN!TE";
const LOGO_FONT = '"Wallpoet", "Orbitron", sans-serif';
const LOGO_IMG_URL = assetUrl("/assets/ignite_logo.svg");

let logoImage: HTMLImageElement | null = null;
let logoLoadState: "idle" | "loading" | "ok" | "fail" = "idle";
let logoLoadWaiters: Array<() => void> = [];

function notifyLogoLoaded(): void {
	const waiters = logoLoadWaiters;
	logoLoadWaiters = [];
	for (const w of waiters) w();
}

/** Prefetch — wywołaj przy starcie overlay, żeby po load przerysować teksturę. */
export function ensureIgnitePitchLogoLoaded(): Promise<boolean> {
	if (logoLoadState === "ok") return Promise.resolve(true);
	if (logoLoadState === "fail") return Promise.resolve(false);
	if (typeof Image === "undefined") {
		logoLoadState = "fail";
		return Promise.resolve(false);
	}
	if (logoLoadState === "loading") {
		return new Promise((resolve) => {
			logoLoadWaiters.push(() => resolve(logoLoadState === "ok"));
		});
	}
	logoLoadState = "loading";
	return new Promise((resolve) => {
		const img = new Image();
		img.decoding = "async";
		img.onload = () => {
			logoImage = img;
			logoLoadState = "ok";
			notifyLogoLoaded();
			resolve(true);
		};
		img.onerror = () => {
			logoImage = null;
			logoLoadState = "fail";
			notifyLogoLoaded();
			resolve(false);
		};
		img.src = LOGO_IMG_URL;
	});
}

export function measureIgniteLogoFontPx(
	ctx: CanvasRenderingContext2D,
	circleRadiusPx: number,
): number {
	const maxLogoW = circleRadiusPx * 1.75;
	const maxLogoH = circleRadiusPx * 0.52;
	let fontPx = Math.floor(circleRadiusPx * 0.44);
	while (fontPx > 18) {
		ctx.font = `700 ${fontPx}px ${LOGO_FONT}`;
		const w = ctx.measureText(LOGO_TEXT).width;
		if (w <= maxLogoW && fontPx <= maxLogoH) break;
		fontPx -= 2;
	}
	return fontPx;
}

function drawWallpoetFallback(
	ctx: CanvasRenderingContext2D,
	circleRadiusPx: number,
): void {
	const fontPx = measureIgniteLogoFontPx(ctx, circleRadiusPx);
	ctx.save();
	ctx.rotate(-0.03);
	ctx.font = `700 ${fontPx}px ${LOGO_FONT}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.strokeStyle = "rgba(5, 8, 6, 0.95)";
	ctx.lineWidth = Math.max(10, fontPx * 0.28);
	ctx.strokeText(LOGO_TEXT, 0, 0);
	ctx.fillStyle = "#071a12";
	ctx.fillText(LOGO_TEXT, 0, 0);
	ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
	ctx.lineWidth = Math.max(3.5, fontPx * 0.075);
	ctx.strokeText(LOGO_TEXT, 0, 0);
	ctx.restore();
}

function drawSvgLogo(
	ctx: CanvasRenderingContext2D,
	circleRadiusPx: number,
): void {
	const img = logoImage!;
	const nw = img.naturalWidth || 1024;
	const nh = img.naturalHeight || 559;
	const maxW = circleRadiusPx * 1.78;
	const maxH = circleRadiusPx * 0.95;
	const scale = Math.min(maxW / nw, maxH / nh);
	const w = nw * scale;
	const h = nh * scale;
	ctx.save();
	ctx.rotate(-0.02);
	ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
	ctx.shadowBlur = Math.max(4, circleRadiusPx * 0.04);
	ctx.shadowOffsetY = Math.max(2, circleRadiusPx * 0.015);
	ctx.drawImage(img, -w * 0.5, -h * 0.5, w, h);
	ctx.restore();
}

/**
 * Logo na środku koła — SVG z public/assets, fallback Wallpoet OFL.
 */
export function drawIgniteGraffitiLogo(
	ctx: CanvasRenderingContext2D,
	centerX: number,
	centerY: number,
	circleRadiusPx: number,
): void {
	ctx.save();
	ctx.translate(centerX, centerY);
	if (logoLoadState === "ok" && logoImage) {
		drawSvgLogo(ctx, circleRadiusPx);
	} else {
		void ensureIgnitePitchLogoLoaded();
		drawWallpoetFallback(ctx, circleRadiusPx);
	}
	ctx.restore();
}

export { LOGO_TEXT as IGNITE_PITCH_LOGO_TEXT };
export const IGNITE_PITCH_LOGO_FONT_CSS = LOGO_FONT;
