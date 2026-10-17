import * as THREE from "three";

import { getBannerEntry } from "../meta/CosmeticCatalog";
import { assetUrl } from "../util/assetUrl";

export type BannerStyleId =
	| "default"
	| "hex"
	| "flame"
	| "circuit"
	| "nova";

const texCache = new Map<string, THREE.CanvasTexture>();
const cssCache = new Map<string, string>();

/** Proceduralny banner RL-style — canvas → texture / CSS url. */
export function buildBannerCanvas(
	style: BannerStyleId,
	size = 512,
): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	const g = ctx.createLinearGradient(0, 0, size, size);

	switch (style) {
		case "hex": {
			g.addColorStop(0, "#061428");
			g.addColorStop(1, "#0a3a58");
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, size, size);
			ctx.strokeStyle = "rgba(80, 220, 255, 0.28)";
			ctx.lineWidth = 2;
			const R = size * 0.07;
			for (let row = -2; row < 12; row++) {
				for (let col = -2; col < 12; col++) {
					const ox = col * R * 1.55 + (row % 2) * R * 0.775;
					const oy = row * R * 1.35;
					ctx.beginPath();
					for (let k = 0; k < 6; k++) {
						const ang = Math.PI / 6 + (k * Math.PI) / 3;
						const x = ox + Math.cos(ang) * R * 0.72;
						const y = oy + Math.sin(ang) * R * 0.72;
						if (k === 0) ctx.moveTo(x, y);
						else ctx.lineTo(x, y);
					}
					ctx.closePath();
					ctx.stroke();
				}
			}
			break;
		}
		case "flame": {
			g.addColorStop(0, "#1a0a08");
			g.addColorStop(0.45, "#4a1808");
			g.addColorStop(1, "#0a2848");
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, size, size);
			for (let i = 0; i < 18; i++) {
				const x0 = (i / 18) * size;
				ctx.strokeStyle = `rgba(255, ${120 + i * 4}, 40, ${0.15 + (i % 3) * 0.08})`;
				ctx.lineWidth = 10 + (i % 4) * 4;
				ctx.beginPath();
				ctx.moveTo(x0 - 40, size + 20);
				ctx.quadraticCurveTo(
					x0 + 30,
					size * 0.45,
					x0 + 10,
					-20,
				);
				ctx.stroke();
			}
			break;
		}
		case "circuit": {
			g.addColorStop(0, "#050810");
			g.addColorStop(1, "#0c2038");
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, size, size);
			ctx.strokeStyle = "rgba(100, 255, 200, 0.35)";
			ctx.lineWidth = 2;
			for (let i = 0; i < 10; i++) {
				const y = ((i + 0.5) / 10) * size;
				ctx.beginPath();
				ctx.moveTo(0, y);
				for (let x = 0; x <= size; x += size / 8) {
					ctx.lineTo(x, y + ((x / size) % 2 === 0 ? -18 : 18));
				}
				ctx.stroke();
			}
			ctx.fillStyle = "rgba(80, 255, 220, 0.55)";
			for (let i = 0; i < 24; i++) {
				ctx.beginPath();
				ctx.arc(
					((i * 97) % size),
					((i * 53) % size),
					3 + (i % 3),
					0,
					Math.PI * 2,
				);
				ctx.fill();
			}
			break;
		}
		case "nova": {
			g.addColorStop(0, "#100818");
			g.addColorStop(1, "#281040");
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, size, size);
			const cx = size * 0.5;
			const cy = size * 0.5;
			for (let i = 0; i < 16; i++) {
				const ang = (i / 16) * Math.PI * 2;
				ctx.strokeStyle = `rgba(255, 180, 80, ${0.2 + (i % 2) * 0.15})`;
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.moveTo(cx, cy);
				ctx.lineTo(
					cx + Math.cos(ang) * size * 0.62,
					cy + Math.sin(ang) * size * 0.62,
				);
				ctx.stroke();
			}
			const rg = ctx.createRadialGradient(cx, cy, 8, cx, cy, size * 0.4);
			rg.addColorStop(0, "rgba(255, 240, 180, 0.85)");
			rg.addColorStop(1, "rgba(255, 120, 40, 0)");
			ctx.fillStyle = rg;
			ctx.beginPath();
			ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2);
			ctx.fill();
			break;
		}
		default: {
			g.addColorStop(0, "#0a1020");
			g.addColorStop(0.55, "#122038");
			g.addColorStop(1, "#1a3050");
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, size, size);
			ctx.fillStyle = "rgba(255, 140, 40, 0.55)";
			ctx.beginPath();
			ctx.moveTo(size * 0.18, size * 0.72);
			ctx.lineTo(size * 0.5, size * 0.22);
			ctx.lineTo(size * 0.82, size * 0.72);
			ctx.closePath();
			ctx.fill();
			ctx.strokeStyle = "rgba(80, 200, 255, 0.45)";
			ctx.lineWidth = 8;
			ctx.strokeRect(size * 0.08, size * 0.08, size * 0.84, size * 0.84);
			break;
		}
	}

	/** Soft vignette — czytelność za autem. */
	const vg = ctx.createRadialGradient(
		size / 2,
		size / 2,
		size * 0.2,
		size / 2,
		size / 2,
		size * 0.72,
	);
	vg.addColorStop(0, "rgba(0,0,0,0)");
	vg.addColorStop(1, "rgba(0,0,0,0.45)");
	ctx.fillStyle = vg;
	ctx.fillRect(0, 0, size, size);
	return canvas;
}

export function resolveBannerStyle(bannerId: string): BannerStyleId {
	const entry = getBannerEntry(bannerId);
	const style = entry?.style ?? bannerId;
	if (
		style === "hex" ||
		style === "flame" ||
		style === "circuit" ||
		style === "nova" ||
		style === "default"
	) {
		return style;
	}
	return "default";
}

export function getBannerTexture(bannerId: string): THREE.CanvasTexture {
	const style = resolveBannerStyle(bannerId);
	const cached = texCache.get(style);
	if (cached) return cached;
	const canvas = buildBannerCanvas(style);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.needsUpdate = true;
	texCache.set(style, tex);
	return tex;
}

/** CSS background-image dla scoreboard / tile. */
export function getBannerCssUrl(bannerId: string): string {
	const style = resolveBannerStyle(bannerId);
	const cached = cssCache.get(style);
	if (cached) return cached;
	const canvas = buildBannerCanvas(style, 256);
	const url = `url(${canvas.toDataURL("image/png")})`;
	cssCache.set(style, url);
	return url;
}

/** Opcjonalny asset PNG — jeśli kiedyś dorzucimy pliki. */
export function bannerAssetPath(bannerId: string): string {
	const entry = getBannerEntry(bannerId);
	if (entry?.texture) return assetUrl(entry.texture);
	return "";
}
