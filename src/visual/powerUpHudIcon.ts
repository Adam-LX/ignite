import * as THREE from "three";

import { drawPowerUpIcon } from "./powerUpIcons";
import { POWER_UP_COLORS, type PowerUpVisualKind } from "./powerUpVisuals";

const TEXTURE_PX = 128;
const textureCache = new Map<PowerUpVisualKind, THREE.CanvasTexture>();

function paintIconCanvas(
	canvas: HTMLCanvasElement,
	kind: PowerUpVisualKind,
): void {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.clearRect(0, 0, TEXTURE_PX, TEXTURE_PX);
	drawPowerUpIcon(ctx, kind, TEXTURE_PX, POWER_UP_COLORS[kind].primary);
}

function createIconTexture(kind: PowerUpVisualKind): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = TEXTURE_PX;
	canvas.height = TEXTURE_PX;
	paintIconCanvas(canvas, kind);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	textureCache.set(kind, tex);
	return tex;
}

/** Ten sam rysunek co HUD — tekstura dla reticle / sprite w świecie. */
export function getPowerUpIconTexture(
	kind: PowerUpVisualKind,
): THREE.CanvasTexture {
	return textureCache.get(kind) ?? createIconTexture(kind);
}

/** Rysuje ikonę power-upu na canvas HUD (wspólne z GLB pickup kolorystycznie). */
export function paintPowerUpHudIcon(
	canvas: HTMLCanvasElement,
	kind: PowerUpVisualKind,
	displayPx = 76,
): void {
	const dpr =
		typeof window !== "undefined"
			? Math.min(window.devicePixelRatio || 1, 2)
			: 1;
	const internal = Math.round(displayPx * dpr);
	canvas.width = internal;
	canvas.height = internal;
	if (canvas.style) {
		canvas.style.width = `${displayPx}px`;
		canvas.style.height = `${displayPx}px`;
	}

	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.clearRect(0, 0, internal, internal);
	drawPowerUpIcon(ctx, kind, internal, POWER_UP_COLORS[kind].primary);
}

export function applyPowerUpAccentVars(
	el: HTMLElement,
	kind: PowerUpVisualKind,
): void {
	const c = POWER_UP_COLORS[kind];
	el.style.setProperty("--power-up-primary", c.primary);
	el.style.setProperty("--power-up-glow", c.glow);
}
