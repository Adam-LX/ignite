import * as THREE from "three";

let cached: THREE.Texture | null = null;

/** Miękka tekstura radialna — szeroka poświata do VFX (boost, iskry). */
export function glowTexture(): THREE.Texture {
	if (cached) return cached;

	const size = 128;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D unavailable");

	const g = ctx.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2,
	);
	g.addColorStop(0, "rgba(255,255,255,1)");
	g.addColorStop(0.12, "rgba(255,255,255,0.82)");
	g.addColorStop(0.38, "rgba(255,255,255,0.38)");
	g.addColorStop(0.68, "rgba(255,255,255,0.1)");
	g.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);

	cached = new THREE.CanvasTexture(canvas);
	cached.colorSpace = THREE.SRGBColorSpace;
	cached.minFilter = THREE.LinearFilter;
	cached.magFilter = THREE.LinearFilter;
	cached.generateMipmaps = false;
	return cached;
}
